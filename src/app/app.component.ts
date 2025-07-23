import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from './data.service';

interface Province {
  ma_tinh: string;
  ten_tinh: string;
}

interface StatWithMaxCount {
  province: string;
  average: number;
  count: number;
  max: number;
  min: number;
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

interface SubjectStats {
  subject: string;
  displayName: string;
  average: number;
  count: number;
  max: number;
  maxCount: number;
  min: number;
  distribution: { range: string; count: number; percentage: number }[];
}

interface ProvinceStats {
  code: string;
  name: string;
  totalStudents: number;
  subjects: SubjectStats[];
}

interface StudentSearchResult {
  student: ExamResult;
  province: string;
  provinceCode: string;
}

type SubjectKey = keyof ExamResult;

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  provinces: Province[] = [];
  allData: ProvinceData[] = [];
  currentStats: ProvinceStats[] = [];
  selectedProvince: string = '';
  selectedSubject: string = 'TOAN';
  searchSBD: string = '';
  searchResult: StudentSearchResult | null = null;
  loading = false;
  activeTab: string = 'overview';
  searchHaveData: boolean = false;

  // Cache info
  cacheInfo: { isCached: boolean; lastUpdate: Date | null; size: number } = {
    isCached: false,
    lastUpdate: null,
    size: 0
  };

  // Loading progress
  loadingProgress: string = '';
  initializationComplete: boolean = false;

  // Statistics
  topProvinces: any[] = [];
  subjectComparison: any[] = [];
  chartData: any[] = [];

  private readonly subjectNames = {
    'TOAN': 'Toán',
    'VAN': 'Văn',
    'NGOAI_NGU': 'Ngoại ngữ',
    'LI': 'Lý',
    'HOA': 'Hóa',
    'SINH': 'Sinh',
    'SU': 'Sử',
    'DIA': 'Địa',
    'GDKT_PL': 'GDKT-PL',
    'TIN_HOC': 'Tin học',
    'GIAO_DUC_CONG_DAN': 'GDCD',
    'CN_CONG_NGHIEP': 'CN Công nghiệp',
    'CN_NONG_NGHIEP': 'CN Nông nghiệp'
  };

  constructor(private dataService: DataService) { }

  ngOnInit() {
    // Subscribe to loading state
    this.dataService.loading$.subscribe(loading => {
      this.loading = loading;
    });

    // Check cache info
    this.updateCacheInfo();

    // Initialize data
    this.initializeData();
  }

  private updateCacheInfo() {
    this.cacheInfo = this.dataService.getCacheInfo();
  }

  private async initializeData() {
    try {
      this.loadingProgress = 'Đang tải danh sách tỉnh...';

      // Load provinces first
      this.dataService.getProvinces().subscribe(provinces => {
        this.provinces = provinces;
        console.log(`📍 Loaded ${provinces.length} provinces`);

        // Check if we have cached data
        if (this.dataService.isAllDataCached()) {
          console.log('✅ All data is cached, loading immediately...');
          this.loadCachedData();
        } else {
          console.log('📥 Initializing cache with all province data...');
          this.loadingProgress = 'Đang tải dữ liệu tất cả tỉnh (lần đầu có thể mất vài phút)...';
          this.initializeAllData();
        }
      });

    } catch (error) {
      console.error('Error initializing data:', error);
      this.loadingProgress = 'Lỗi khi tải dữ liệu';
    }
  }

  private loadCachedData() {
    this.loadingProgress = 'Đang tải dữ liệu từ cache...';

    // Get all cached data immediately
    this.allData = this.dataService.getAllCachedProvinceData();
    this.processData();
    this.loadStatistics();

    this.initializationComplete = true;
    this.loadingProgress = '';
    this.updateCacheInfo();

    console.log('⚡ Data loaded from cache instantly!');
  }

  private initializeAllData() {
    this.dataService.initializeAllData().subscribe(
      success => {
        if (success) {
          console.log('✅ All data initialized and cached');
          this.loadCachedData();
        } else {
          console.error('❌ Failed to initialize data');
          this.loadingProgress = 'Lỗi khi tải dữ liệu';
        }
      },
      error => {
        console.error('Error during initialization:', error);
        this.loadingProgress = 'Lỗi khi tải dữ liệu';
      }
    );
  }

  processData() {
    const dataToProcess = this.selectedProvince ?
      this.allData.filter(d => d.province_code === this.selectedProvince) :
      this.allData;

    this.currentStats = dataToProcess.map(provinceData => {
      const stats: ProvinceStats = {
        code: provinceData.province_code,
        name: provinceData.province_name,
        totalStudents: provinceData.total_records,
        subjects: []
      };

      // Process each subject
      Object.keys(this.subjectNames).forEach(subject => {
        const validScores = provinceData.data
          .map(student => student[subject as keyof ExamResult] as number)
          .filter(score => score != null && score > 0);

        if (validScores.length > 0) {
          const average = validScores.reduce((sum, score) => sum + score, 0) / validScores.length;
          const max = Math.max(...validScores);
          const min = Math.min(...validScores);
          const distribution = this.calculateDistribution(validScores);

          stats.subjects.push({
            subject,
            displayName: this.subjectNames[subject as keyof typeof this.subjectNames],
            average,
            count: validScores.length,
            max,
            maxCount: this.getMaxScoreCount(provinceData.province_code, subject, max),
            min,
            distribution
          });
        }
      });

      return stats;
    });
  }

  calculateDistribution(scores: number[]): { range: string; count: number; percentage: number }[] {
    const ranges = [
      { min: 0, max: 1, range: '0-1' },
      { min: 1, max: 2, range: '1-2' },
      { min: 2, max: 3, range: '2-3' },
      { min: 3, max: 4, range: '3-4' },
      { min: 4, max: 5, range: '4-5' },
      { min: 5, max: 6, range: '5-6' },
      { min: 6, max: 7, range: '6-7' },
      { min: 7, max: 8, range: '7-8' },
      { min: 8, max: 9, range: '8-9' },
      { min: 9, max: 10, range: '9-10' }
    ];

    return ranges.map(range => {
      const count = scores.filter(score => score >= range.min && score <= range.max).length;
      const percentage = (count / scores.length) * 100;
      return { range: range.range, count, percentage };
    });
  }

  loadStatistics() {
    this.dataService.getStatistics(this.selectedSubject, 63).subscribe(stats => {
      this.topProvinces = stats.slice(0, 10);
      this.prepareChartData();
    });
  }

  prepareChartData() {
    this.chartData = this.topProvinces.map(stat => ({
      name: stat.province,
      value: parseFloat(stat.average.toFixed(2))
    }));
  }

  // Search student
  searchStudent() {
    if (!this.searchSBD.trim()) {
      this.searchResult = null;
      return;
    }

    this.dataService.searchStudent(this.searchSBD.trim()).subscribe(
      result => {
        this.searchResult = result;
        this.searchHaveData = false;
      },
      error => {
        this.searchResult = null;
        this.searchHaveData = true;
        console.error('Student not found:', error);
      }
    );
  }

  clearSearch() {
    this.searchSBD = '';
    this.searchResult = null;
    this.searchHaveData = false;
  }

  // Event handlers
  onProvinceChange() {
    this.processData();
    this.loadStatistics();
  }

  onSubjectChange() {
    this.loadStatistics();
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
  }

  // Cache management
  refreshData() {
    console.log('🔄 Refreshing cache...');
    this.loadingProgress = 'Đang làm mới dữ liệu...';
    this.initializationComplete = false;

    this.dataService.refreshCache().subscribe(
      success => {
        if (success) {
          this.loadCachedData();
          console.log('✅ Cache refreshed successfully');
        } else {
          console.error('❌ Failed to refresh cache');
          this.loadingProgress = 'Lỗi khi làm mới dữ liệu';
        }
      }
    );
  }

  // Utility methods
  getTotalStudents(): number {
    return this.currentStats.reduce((sum, stat) => sum + stat.totalStudents, 0);
  }

  getHighestAverage(): number {
    let highest = 0;
    this.currentStats.forEach(stat => {
      stat.subjects.forEach(subject => {
        if (subject.average > highest) {
          highest = subject.average;
        }
      });
    });
    return highest;
  }

  getProvinceCount(): number {
    return this.currentStats.length;
  }

  getSubjectCount(): number {
    return Object.keys(this.subjectNames).length;
  }

  getAvailableSubjects(): SubjectKey[] {
    return [
      'TOAN', 'VAN', 'NGOAI_NGU', 'LI', 'HOA', 'SINH',
      'SU', 'DIA', 'GDKT_PL', 'TIN_HOC', 'GIAO_DUC_CONG_DAN',
      'CN_CONG_NGHIEP', 'CN_NONG_NGHIEP'
    ];
  }

  getSubjectDisplayName(subject: string): string {
    return this.subjectNames[subject as keyof typeof this.subjectNames] || subject;
  }

  getTopProvinces(subject: string): { name: string; average: number }[] {
    return this.currentStats
      .map(stat => {
        const subjectData = stat.subjects.find(s => s.subject === subject);
        return {
          name: stat.name,
          average: subjectData ? subjectData.average : 0
        };
      })
      .filter(item => item.average > 0)
      .sort((a, b) => b.average - a.average)
      .slice(0, 10);
  }

  getDetailedStats(): ProvinceStats[] {
    return this.currentStats.sort((a, b) => a.name.localeCompare(b.name));
  }

  getSubjectAverage(stat: ProvinceStats, subject: string): number {
    const subjectData = stat.subjects.find(s => s.subject === subject);
    return subjectData ? subjectData.average : 0;
  }

  // getSubjectStats(subject: string) {
  //   const allStats = this.currentStats.map(stat => {
  //     const subjectData = stat.subjects.find(s => s.subject === subject);
  //     return {
  //       province: stat.name,
  //       average: subjectData ? subjectData.average : 0,
  //       count: subjectData ? subjectData.count : 0,
  //       max: subjectData ? subjectData.max : 0,
  //       min: subjectData ? subjectData.min : 0
  //     };
  //   }).filter(stat => stat.average > 0);

  //   return allStats.sort((a, b) => b.average - a.average);
  // }

  getSubjectStats(subject: string) {
    const allStats = this.currentStats.map(stat => {
      const subjectData = stat.subjects.find(s => s.subject === subject);
      if (!subjectData) {
        return {
          province: stat.name,
          average: 0,
          count: 0,
          max: 0,
          maxCount: 0,
          min: 0
        };
      }

      // Tính số thí sinh có điểm cao nhất
      const maxCount = this.getMaxScoreCount(stat.code, subject, subjectData.max);

      return {
        province: stat.name,
        average: subjectData.average,
        count: subjectData.count,
        max: subjectData.max,
        maxCount: maxCount,
        min: subjectData.min
      };
    }).filter(stat => stat.average > 0);

    return allStats.sort((a, b) => b.average - a.average);
  }

  // Hàm mới để tính số thí sinh có điểm cao nhất
  getMaxScoreCount(provinceCode: string, subject: string, maxScore: number): number {
    const provinceData = this.allData.find(p => p.province_code === provinceCode);
    if (!provinceData) return 0;

    const subjectKey = this.getSubjectKey(subject);
    if (!subjectKey) return 0;

    return provinceData.data.filter(student => {
      const score = student[subjectKey];
      return typeof score === 'number' && !isNaN(score) && Math.abs(score - maxScore) < 0.01;
    }).length;
  }

  // Hàm helper để lấy key của môn học
  getSubjectKey(subject: string): SubjectKey | null {
    const subjectMapping: { [key: string]: SubjectKey } = {
      'TOAN': 'TOAN',
      'VAN': 'VAN',
      'NGOAI_NGU': 'NGOAI_NGU',
      'LI': 'LI',
      'HOA': 'HOA',
      'SINH': 'SINH',
      'SU': 'SU',
      'DIA': 'DIA',
      'GDKT_PL': 'GDKT_PL',
      'TIN_HOC': 'TIN_HOC',
      'GIAO_DUC_CONG_DAN': 'GIAO_DUC_CONG_DAN',
      'CN_CONG_NGHIEP': 'CN_CONG_NGHIEP',
      'CN_NONG_NGHIEP': 'CN_NONG_NGHIEP'
    };

    return subjectMapping[subject] || null;
  }

  getSubjectMax(stat: ProvinceStats, subject: string): number {
    const subjectData = stat.subjects.find(s => s.subject === subject);
    return subjectData ? subjectData.max : 0;
  }

  getSubjectMin(stat: ProvinceStats, subject: string): number {
    const subjectData = stat.subjects.find(s => s.subject === subject);
    return subjectData ? subjectData.min : 0;
  }

  trackByProvince(index: number, stat: any): any {
    return stat.province;
  }

  getScoreDistribution(subject: string) {
    for (const provinceStat of this.currentStats) {
      const subjectStat = provinceStat.subjects.find(s => s.subject === subject);
      if (subjectStat && subjectStat.distribution) {
        return subjectStat.distribution;
      }
    }
    return [];
  }

  getOverallAverage(subject: string): number {
    const stats = this.getSubjectStats(subject);
    if (!stats || stats.length === 0) return 0;

    let total = 0;
    let count = 0;
    for (const stat of stats) {
      if (stat.average > 0 && stat.count > 0) {
        total += stat.average * stat.count;
        count += stat.count;
      }
    }
    return count > 0 ? total / count : 0;
  }

  // Cache status methods
  getCacheStatusText(): string {
    if (!this.cacheInfo.isCached) {
      return 'Chưa có cache';
    }

    const lastUpdate = this.cacheInfo.lastUpdate;
    if (lastUpdate) {
      const now = new Date();
      const diff = now.getTime() - lastUpdate.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));

      if (hours < 1) {
        const minutes = Math.floor(diff / (1000 * 60));
        return `Cache ${minutes} phút trước`;
      } else if (hours < 24) {
        return `Cache ${hours} giờ trước`;
      } else {
        const days = Math.floor(hours / 24);
        return `Cache ${days} ngày trước`;
      }
    }

    return 'Cache không xác định thời gian';
  }

  getCacheSize(): string {
    return `${this.cacheInfo.size}/${this.provinces.length} tỉnh`;
  }

  shouldShowInitializationProgress(): boolean {
    return !this.initializationComplete && this.loadingProgress !== '';
  }
}