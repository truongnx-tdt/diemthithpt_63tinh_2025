import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, map } from 'rxjs';
import { DataService } from './data.service';


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

interface SubjectStats {
  subject: string;
  displayName: string;
  average: number;
  count: number;
  max: number;
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


type SubjectKey = keyof ExamResult; // Sẽ là "TOAN" | "VAN" | ...

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
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

  // Thống kê
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
    this.loadData();
    this.dataService.loading$.subscribe(loading => {
      this.loading = loading;
    });
  }

  async loadData() {
    try {
      // Load danh sách tỉnh
      this.dataService.getProvinces().subscribe(provinces => {
        this.provinces = provinces;
        this.loadAllData();
      });
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
  }

  async loadAllData() {
    try {
      const allDataPromises = this.provinces.map(province =>
        this.dataService.getExamResults(province.ma_tinh).toPromise()
          .then(data => ({
            ...data,
            province_code: province.ma_tinh,
            province_name: province.ten_tinh
          }))
          .catch(error => {
            console.log(`Error loading data for ${province.ten_tinh}`);
            return null;
          })
      );

      const results = await Promise.all(allDataPromises);
      this.allData = results.filter(data => data !== null) as ProvinceData[];
      this.processData();
      this.loadStatistics();
    } catch (error) {
      console.error('Error loading all data:', error);
    }
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

      // Xử lý từng môn học
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

  // Tìm kiếm học sinh
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
      'TOAN',
      'VAN',
      'NGOAI_NGU',
      'LI',
      'HOA',
      'SINH',
      'SU',
      'DIA',
      'GDKT_PL',
      'TIN_HOC',
      'GIAO_DUC_CONG_DAN',
      'CN_CONG_NGHIEP',
      'CN_NONG_NGHIEP'
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

  getSubjectStats(subject: string) {
    const allStats = this.currentStats.map(stat => {
      const subjectData = stat.subjects.find(s => s.subject === subject);
      return {
        province: stat.name,
        average: subjectData ? subjectData.average : 0,
        count: subjectData ? subjectData.count : 0,
        max: subjectData ? subjectData.max : 0,
        min: subjectData ? subjectData.min : 0
      };
    }).filter(stat => stat.average > 0);

    return allStats.sort((a, b) => b.average - a.average);
  }

  compareProvinces(provinces: string[]): any[] {
    return provinces.map(provinceCode => {
      const stat = this.currentStats.find(s => s.code === provinceCode);
      if (stat) {
        return {
          name: stat.name,
          totalStudents: stat.totalStudents,
          subjects: stat.subjects.map(subject => ({
            subject: subject.subject,
            displayName: subject.displayName,
            average: subject.average,
            count: subject.count
          }))
        };
      }
      return null;
    }).filter(item => item !== null);
  }

  refreshData() {
    this.loadData();
  }

  getSubjectMax(stat: ProvinceStats, subject: string): number {
    const subjectData = stat.subjects.find(s => s.subject === subject);
    return subjectData ? subjectData.max : 0;
  }

  getSubjectMin(stat: ProvinceStats, subject: string): number {
    const subjectData = stat.subjects.find(s => s.subject === subject);
    return subjectData ? subjectData.min : 0;
  }

}
