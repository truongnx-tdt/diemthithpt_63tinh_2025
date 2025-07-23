import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

export const app = express();
const angularApp = new AngularNodeAppEngine();

// Cache for provinces data to avoid repeated file reads
let provincesCache: any[] = [];
let provincesCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Helper function to get provinces data with caching
 */
function getProvincesData(): any[] {
  const now = Date.now();
  if (provincesCache && (now - provincesCacheTime) < CACHE_DURATION) {
    return provincesCache;
  }
  try {
    const filePath = join(process.cwd(), 'assets', 'data.json');

    if (!existsSync(filePath)) {
      console.error(`Provinces file not found: ${filePath}`);
      return [];
    }

    const jsonData = readFileSync(filePath, 'utf-8');
    provincesCache = JSON.parse(jsonData);
    provincesCacheTime = now;
    return provincesCache;

  } catch (error) {
    console.error('Error loading provinces data:', error);
    return [];
  }
}

/**
 * Helper function to get province info by ID
 */
function getProvinceInfo(tinhId: number): { code: string; name: string } {
  const provinceList = getProvincesData();
  const code = tinhId.toString().padStart(2, '0');
  const province = provinceList.find((p: { ma_tinh: string; }) => p.ma_tinh === code);

  if (province) {
    return {
      code,
      name: province.ten_tinh
    };
  } else {
    return {
      code,
      name: 'Không rõ'
    };
  }
}

/**
 * Helper function to calculate subject statistics
 */
function calculateSubjectStats(data: any[], subject: string) {
  const scores = data
    .map(student => student[subject])
    .filter(score => score != null && score > 0 && score !== -1);

  if (scores.length === 0) {
    return { average: 0, count: 0, max: 0, min: 0 };
  }

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const max = Math.max(...scores);
  const min = Math.min(...scores);

  return { average, count: scores.length, max, min };
}

/**
 * API Routes
 */

// API để lấy danh sách tỉnh
app.get('/api/get-provinces', async (req, res) => {
  try {
    const provinces = getProvincesData();

    if (provinces.length === 0) {
      res.status(404).json({ error: 'No provinces data found' });
      return;
    }

    res.json(provinces);

  } catch (error) {
    console.error('Error in get-provinces API:', error);
    res.status(500).json({
      error: 'Error loading provinces data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API để lấy dữ liệu điểm thi theo tỉnh
app.get('/api/get-exam-results/:provinceCode', async (req, res) => {
  try {
    const { provinceCode } = req.params;

    // Validate province code
    if (!provinceCode || !/^\d{2}$/.test(provinceCode)) {
      res.status(400).json({ error: 'Invalid province code format' });
      return;
    }

    const filePath = join(process.cwd(), 'assets', 'results', `exam_results_${provinceCode}.json`);

    if (!existsSync(filePath)) {
      console.log(`Exam results file not found: ${filePath}`);
      res.status(404).json({ error: 'Exam results not found for this province' });
      return;
    }

    console.log(`Loading exam results from: ${filePath}`);
    const jsonData = readFileSync(filePath, 'utf-8');
    const examData = JSON.parse(jsonData);

    // Validate data structure
    if (!examData || !Array.isArray(examData.data)) {
      res.status(500).json({ error: 'Invalid exam data format' });
      return;
    }

    // Get province name
    const provinces = getProvincesData();
    const province = provinces.find(p => p.ma_tinh === provinceCode);

    const response = {
      ...examData,
      province_code: provinceCode,
      province_name: province ? province.ten_tinh : 'Không rõ'
    };

    res.json(response);

  } catch (error) {
    console.error('Error loading exam results:', error);
    res.status(500).json({
      error: 'Error loading exam results data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API để tìm kiếm theo số báo danh
app.get('/api/search-student/:sbd', async (req, res) => {
  try {
    const { sbd } = req.params;

    // Validate SBD format
    if (!sbd || !/^\d{8}$/.test(sbd)) {
      res.status(400).json({ error: 'SBD phải có đúng 8 chữ số' });
      return;
    }

    console.log(`🔍 Searching for student with SBD: ${sbd}`);

    // Call external API
    const apiUrl = `https://s6.tuoitre.vn/api/diem-thi-thpt.htm?sbd=${sbd}&year=2025`;

    try {
      const response = await fetch(apiUrl);

      if (!response.ok) {
        console.log(`External API responded with status: ${response.status}`);
        res.status(404).json({ error: 'Không tìm thấy dữ liệu thí sinh' });
        return;
      }

      const data = await response.json();

      // Validate response structure
      if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
        res.status(404).json({ error: 'Không tìm thấy thí sinh' });
        return;
      }

      const record = data.data[0];

      // Map the response to our format
      const examResult = {
        SBD: record.SBD,
        TOAN: record.TOAN || -1,
        VAN: record.VAN || -1,
        NGOAI_NGU: record.NGOAI_NGU || -1,
        LI: record.LI || -1,
        HOA: record.HOA || -1,
        SINH: record.SINH || -1,
        SU: record.SU || -1,
        DIA: record.DIA || -1,
        GDKT_PL: record.GDKT_PL || -1,
        TIN_HOC: record.TIN_HOC || -1,
        GIAO_DUC_CONG_DAN: record.GIAO_DUC_CONG_DAN || -1,
        CN_CONG_NGHIEP: record.CN_CONG_NGHIEP || -1,
        CN_NONG_NGHIEP: record.CN_NONG_NGHIEP || -1,
        TONGDIEM: record.TONGDIEM || 0
      };

      // Get province info
      const { code, name } = getProvinceInfo(record.TinhId || 0);

      const result = {
        student: examResult,
        province: name,
        provinceCode: code
      };

      console.log(`✅ Found student: ${examResult.SBD} from ${name}`);
      res.json(result);

    } catch (fetchError) {
      console.error('Error calling external API:', fetchError);
      res.status(503).json({ error: 'Lỗi khi truy cập dữ liệu từ nguồn bên ngoài' });
      return;
    }

  } catch (error) {
    console.error('Error in search-student API:', error);
    res.status(500).json({
      error: 'Lỗi server',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API để lấy thống kê tổng hợp
app.get('/api/get-statistics', async (req, res) => {
  try {
    const { subject, limit = 10 } = req.query;

    // Validate parameters
    if (!subject || typeof subject !== 'string') {
      res.status(400).json({ error: 'Subject parameter is required' });
      return;
    }

    const limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      res.status(400).json({ error: 'Limit must be between 1 and 100' });
      return;
    }

    const provincesData = getProvincesData();

    if (provincesData.length === 0) {
      res.status(404).json({ error: 'No provinces data available' });
      return;
    }

    const statistics = [];
    let processedCount = 0;
    let errorCount = 0;

    for (const province of provincesData) {
      try {
        const examPath = join(process.cwd(), 'assets', 'results', `exam_results_${province.ma_tinh}.json`);

        if (!existsSync(examPath)) {
          console.log(`File not found for province ${province.ten_tinh} (${province.ma_tinh})`);
          errorCount++;
          continue;
        }

        const examData = JSON.parse(readFileSync(examPath, 'utf-8'));

        if (!examData || !Array.isArray(examData.data)) {
          console.warn(`Invalid data format for province ${province.ten_tinh}`);
          errorCount++;
          continue;
        }

        const subjectStats = calculateSubjectStats(examData.data, subject);

        if (subjectStats.count > 0) {
          statistics.push({
            province: province.ten_tinh,
            provinceCode: province.ma_tinh,
            totalStudents: examData.total_records || examData.data.length,
            ...subjectStats
          });
          processedCount++;
        }

      } catch (error) {
        console.warn(`Error processing province ${province.ten_tinh}:`, error);
        errorCount++;
      }
    }

    console.log(`📊 Statistics: Processed ${processedCount} provinces, ${errorCount} errors for subject ${subject}`);

    // Sort by average score (descending)
    statistics.sort((a, b) => b.average - a.average);

    const result = statistics.slice(0, limitNum);

    res.json(result);

  } catch (error) {
    console.error('Error in get-statistics API:', error);
    res.status(500).json({
      error: 'Error getting statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const provinces = getProvincesData();
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    provinces_loaded: provinces.length,
    cache_active: provincesCache !== null
  });
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`🚀 Node Express server listening on http://localhost:${port}`);
    console.log(`📁 Browser files: ${browserDistFolder}`);
    console.log(`📊 Loading provinces data...`);

    // Pre-load provinces data
    const provinces = getProvincesData();
    console.log(`✅ Pre-loaded ${provinces.length} provinces`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);