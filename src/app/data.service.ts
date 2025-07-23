import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, forkJoin } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';

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

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  constructor(private http: HttpClient) { }

  // Lấy danh sách tỉnh
  getProvinces(): Observable<Province[]> {
    this.loadingSubject.next(true);
    return this.http.get<Province[]>('/api/get-provinces').pipe(
      map(data => {
        this.loadingSubject.next(false);
        return data;
      }),
      catchError(error => {
        this.loadingSubject.next(false);
        console.error('Error loading provinces:', error);
        return [];
      })
    );
  }

  // Lấy dữ liệu điểm thi theo tỉnh
  getExamResults(provinceCode: string): Observable<ProvinceData> {
    this.loadingSubject.next(true);
    return this.http.get<ProvinceData>(`/api/get-exam-results/${provinceCode}`).pipe(
      map(data => {
        this.loadingSubject.next(false);
        return data;
      }),
      catchError(error => {
        this.loadingSubject.next(false);
        console.error('Error loading exam results:', error);
        throw error;
      })
    );
  }

  // Tìm kiếm học sinh theo số báo danh
  searchStudent(sbd: string): Observable<StudentSearchResult> {
    this.loadingSubject.next(true);
    return this.http.get<StudentSearchResult>(`/api/search-student/${sbd}`).pipe(
      map(data => {
        this.loadingSubject.next(false);
        return data;
      }),
      catchError(error => {
        this.loadingSubject.next(false);
        console.error('Error searching student:', error);
        throw error;
      })
    );
  }

  // Lấy thống kê theo môn học
  getStatistics(subject: string, limit: number = 10): Observable<Statistics[]> {
    this.loadingSubject.next(true);
    return this.http.get<Statistics[]>(`/api/get-statistics?subject=${subject}&limit=${limit}`).pipe(
      map(data => {
        this.loadingSubject.next(false);
        return data;
      }),
      catchError(error => {
        this.loadingSubject.next(false);
        console.error('Error loading statistics:', error);
        return [];
      })
    );
  }

  // Lấy tất cả dữ liệu tỉnh
  getAllProvinceData(): Observable<ProvinceData[]> {
    this.loadingSubject.next(true);
    return this.getProvinces().pipe(
      switchMap((provinces) => {
        const observables = provinces.map((province) =>
          this.getExamResults(province.ma_tinh).pipe(
            map(data => ({
              ...data,
              province_code: province.ma_tinh,
              province_name: province.ten_tinh
            })),
            catchError(error => {
              console.log(`Error loading data for ${province.ten_tinh}`);
              return [];
            })
          )
        );
        return forkJoin(observables);
      }),
      map((allData) => {
        this.loadingSubject.next(false);
        // Filter out any empty arrays (from catchError)
        return allData.filter(data => Array.isArray(data) ? false : data) as ProvinceData[];
      })
    );
  }
}