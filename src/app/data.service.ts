import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, forkJoin, of } from 'rxjs';
import { map, catchError, switchMap, tap } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';

interface Province {
  ma_tinh: string;
  ten_tinh: string;
}

interface ExamResult {
  SBD: string;
  TOAN: number;
  VAN: number;
  NGOAI_NGU: number;
  LI: number;
  HOA: number;
  SINH: number;
  SU: number;
  DIA: number;
  GDKT_PL: number;
  TIN_HOC: number;
  GIAO_DUC_CONG_DAN: number;
  CN_CONG_NGHIEP: number;
  CN_NONG_NGHIEP: number;
  TONGDIEM: number;
}

interface ProvinceData {
  province_code: string;
  province_name: string;
  total_records: number;
  data: ExamResult[];
}

interface StudentSearchResult {
  student: ExamResult;
  province: string;
  provinceCode: string;
}

interface Statistics {
  province: string;
  provinceCode: string;
  totalStudents: number;
  average: number;
  count: number;
  max: number;
  min: number;
}

interface CachedData {
  provinces: Province[];
  provinceData: { [key: string]: ProvinceData };
  statistics: { [key: string]: Statistics[] };
  timestamp: number;
  version: string;
}

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  // In-memory cache
  private cache: CachedData = {
    provinces: [],
    provinceData: {},
    statistics: {},
    timestamp: 0,
    version: '1.0'
  };

  // Cache settings
  private readonly CACHE_KEY = 'exam_data_cache';
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private readonly CURRENT_VERSION = '1.0';

  // check in browser
  constructor(private http: HttpClient, @Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this.loadFromStorage();
    }
  }

  // Load data from localStorage (or use in-memory for artifacts)
  private loadFromStorage(): void {
    try {
      // For deployment, replace with localStorage
      // const cached = localStorage.getItem(this.CACHE_KEY);

      // For artifacts, we use in-memory cache (data will be lost on refresh)
      // In real deployment, uncomment the localStorage lines

      /*
      if (cached) {
        const cachedData: CachedData = JSON.parse(cached);
        
        // Check if cache is still valid
        if (this.isCacheValid(cachedData)) {
          this.cache = cachedData;
          console.log('✅ Loaded data from cache');
        } else {
          console.log('⚠️ Cache expired, will reload data');
          this.clearCache();
        }
      }
      */

    } catch (error) {
      console.error('Error loading from cache:', error);
      this.clearCache();
    }
  }

  // Save data to localStorage (or keep in memory for artifacts)
  private saveToStorage(): void {
    try {
      this.cache.timestamp = Date.now();
      this.cache.version = this.CURRENT_VERSION;

      // For deployment, replace with localStorage
      // localStorage.setItem(this.CACHE_KEY, JSON.stringify(this.cache));

      console.log('💾 Data cached successfully');
    } catch (error) {
      console.error('Error saving to cache:', error);
    }
  }

  // Check if cache is valid
  private isCacheValid(cachedData: CachedData): boolean {
    const now = Date.now();
    const cacheAge = now - cachedData.timestamp;

    return (
      cachedData.version === this.CURRENT_VERSION &&
      cacheAge < this.CACHE_DURATION &&
      cachedData.provinces.length > 0
    );
  }

  // Clear cache
  private clearCache(): void {
    this.cache = {
      provinces: [],
      provinceData: {},
      statistics: {},
      timestamp: 0,
      version: this.CURRENT_VERSION
    };

    // For deployment
    // localStorage.removeItem(this.CACHE_KEY);
  }

  // Get cache info
  getCacheInfo(): { isCached: boolean; lastUpdate: Date | null; size: number } {
    const isCached = this.cache.provinces.length > 0;
    const lastUpdate = this.cache.timestamp ? new Date(this.cache.timestamp) : null;
    const size = Object.keys(this.cache.provinceData).length;

    return { isCached, lastUpdate, size };
  }

  // Force refresh cache
  refreshCache(): Observable<boolean> {
    this.clearCache();
    return this.initializeAllData();
  }

  // Initialize all data at once
  initializeAllData(): Observable<boolean> {
    if (isPlatformBrowser(this.platformId)) {
      this.loadingSubject.next(true);

      return this.getProvinces().pipe(
        switchMap(provinces => {
          if (provinces.length === 0) {
            throw new Error('No provinces loaded');
          }

          console.log(`📥 Loading data for ${provinces.length} provinces...`);

          // Load all province data in parallel
          const observables = provinces.map(province =>
            this.http.get<ProvinceData>(`/api/get-exam-results/${province.ma_tinh}`).pipe(
              map(data => ({
                ...data,
                province_code: province.ma_tinh,
                province_name: province.ten_tinh
              })),
              catchError(error => {
                console.warn(`❌ Failed to load ${province.ten_tinh}:`, error.message);
                return of(null);
              })
            )
          );

          return forkJoin(observables).pipe(
            map(results => {
              // Filter out failed requests
              const validResults = results.filter(result => result !== null) as ProvinceData[];

              // Cache the results
              validResults.forEach(provinceData => {
                this.cache.provinceData[provinceData.province_code] = provinceData;
              });

              this.saveToStorage();
              console.log(`✅ Cached data for ${validResults.length} provinces`);

              return true;
            })
          );
        }),
        tap(() => this.loadingSubject.next(false)),
        catchError(error => {
          this.loadingSubject.next(false);
          console.error('Error initializing data:', error);
          return of(false);
        })
      );
    } else {
      return of(true);
    }
  }

  // Get provinces (cached or fresh)
  getProvinces(): Observable<Province[]> {
    // Return cached data if available
    if (!isPlatformBrowser(this.platformId))
      return of([]);
    if (this.cache.provinces.length > 0) {
      return of(this.cache.provinces);
    }

    // Otherwise load from API
    this.loadingSubject.next(true);
    return this.http.get<Province[]>('/api/get-provinces').pipe(
      tap(provinces => {
        this.cache.provinces = provinces;
        this.saveToStorage();
        this.loadingSubject.next(false);
      }),
      catchError(error => {
        this.loadingSubject.next(false);
        console.error('Error loading provinces:', error);
        return of([]);
      })
    );
  }

  // Get exam results (cached or fresh)
  getExamResults(provinceCode: string): Observable<ProvinceData> {
    if (!isPlatformBrowser(this.platformId))
      return of({} as ProvinceData);
    // Return cached data if available
    const cachedData = this.cache.provinceData[provinceCode];
    if (cachedData) {
      return of(cachedData);
    }

    // Otherwise load from API
    this.loadingSubject.next(true);
    return this.http.get<ProvinceData>(`/api/get-exam-results/${provinceCode}`).pipe(
      tap(data => {
        // Cache the result
        this.cache.provinceData[provinceCode] = data;
        this.saveToStorage();
        this.loadingSubject.next(false);
      }),
      catchError(error => {
        this.loadingSubject.next(false);
        console.error('Error loading exam results:', error);
        throw error;
      })
    );
  }

  // Get all cached province data
  getAllCachedProvinceData(): ProvinceData[] {
    return Object.values(this.cache.provinceData);
  }

  // Check if all data is cached
  isAllDataCached(): boolean {
    const totalProvinces = this.cache.provinces.length;
    const cachedProvinces = Object.keys(this.cache.provinceData).length;
    return totalProvinces > 0 && cachedProvinces === totalProvinces;
  }

  // Get cached statistics or calculate
  getStatistics(subject: string, limit: number = 10): Observable<Statistics[]> {
    const cacheKey = `${subject}_${limit}`;

    // Return cached statistics if available
    if (this.cache.statistics[cacheKey]) {
      return of(this.cache.statistics[cacheKey]);
    }

    // If we have cached province data, calculate statistics locally
    if (this.isAllDataCached()) {
      const statistics = this.calculateStatistics(subject, limit);
      this.cache.statistics[cacheKey] = statistics;
      this.saveToStorage();
      return of(statistics);
    }

    // Otherwise call API
    this.loadingSubject.next(true);
    return this.http.get<Statistics[]>(`/api/get-statistics?subject=${subject}&limit=${limit}`).pipe(
      tap(data => {
        this.cache.statistics[cacheKey] = data;
        this.saveToStorage();
        this.loadingSubject.next(false);
      }),
      catchError(error => {
        this.loadingSubject.next(false);
        console.error('Error loading statistics:', error);
        return of([]);
      })
    );
  }

  // Calculate statistics from cached data
  private calculateStatistics(subject: string, limit: number): Statistics[] {
    const statistics: Statistics[] = [];

    Object.values(this.cache.provinceData).forEach(provinceData => {
      const scores = provinceData.data
        .map(student => student[subject as keyof ExamResult] as number)
        .filter(score => score != null && score > 0);

      if (scores.length > 0) {
        const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        const max = Math.max(...scores);
        const min = Math.min(...scores);

        statistics.push({
          province: provinceData.province_name,
          provinceCode: provinceData.province_code,
          totalStudents: provinceData.total_records,
          average,
          count: scores.length,
          max,
          min
        });
      }
    });

    // Sort by average and limit results
    return statistics
      .sort((a, b) => b.average - a.average)
      .slice(0, limit);
  }

  // Search student (no caching for this as it's dynamic)
  searchStudent(sbd: string): Observable<StudentSearchResult> {
    this.loadingSubject.next(true);
    return this.http.get<StudentSearchResult>(`/api/search-student/${sbd}`).pipe(
      tap(() => this.loadingSubject.next(false)),
      catchError(error => {
        this.loadingSubject.next(false);
        console.error('Error searching student:', error);
        throw error;
      })
    );
  }

  // Get all province data (cached or fresh)
  getAllProvinceData(): Observable<ProvinceData[]> {
    // If all data is cached, return immediately
    if (this.isAllDataCached()) {
      return of(this.getAllCachedProvinceData());
    }

    // Otherwise initialize all data
    return this.initializeAllData().pipe(
      map(success => {
        if (success) {
          return this.getAllCachedProvinceData();
        }
        return [];
      })
    );
  }
}