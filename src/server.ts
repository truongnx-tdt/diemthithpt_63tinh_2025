import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

export const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/**', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

// API để lấy danh sách tỉnh
app.get('/api/get-provinces', async (req, res) => {
  try {
    const filePath = join(process.cwd(), 'assets', 'data.json');
    console.log(`Loading provinces from: ${filePath}`);
    const jsonData = readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(jsonData));
  } catch (error) {
    console.error('Error loading provinces:', error);
    res.status(500).json({ error: 'Error loading provinces data' });
  }
});

// API để lấy dữ liệu điểm thi theo tỉnh
app.get('/api/get-exam-results/:provinceCode', async (req, res) => {
  try {
    const { provinceCode } = req.params;
    const filePath = join(process.cwd(), 'assets', 'results', `exam_results_${provinceCode}.json`);
    console.log(`Loading exam results from: ${filePath}`);
    const jsonData = readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(jsonData));
  } catch (error) {
    console.error('Error loading exam results:', error);
    res.status(500).json({ error: 'Error loading exam results data' });
  }
});

// API để tìm kiếm theo số báo danh
app.get('/api/search-student/:sbd', async (req, res) => {
  try {
    const { sbd } = req.params;

    if (sbd.length === 8) {
      const apiUrl = `https://s6.tuoitre.vn/api/diem-thi-thpt.htm?sbd=${sbd}&year=2025`;
      var response = await fetch(apiUrl);
      if (!response.ok) {
        res.status(response.status).json({ error: 'Không tìm thấy dữ liệu thí sinh' });
        return;
      }

      const data = await response.json();

      if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
        res.status(404).json({ error: 'Không tìm thấy thí sinh' });
        return;
      }

      const record = data.data[0];

      const examResult = {
        SBD: record.SBD,
        TOAN: record.TOAN,
        VAN: record.VAN,
        NGOAI_NGU: record.NGOAI_NGU,
        LI: record.LI,
        HOA: record.HOA,
        SINH: record.SINH,
        SU: record.SU,
        DIA: record.DIA,
        GDKT_PL: record.GDKT_PL,
        TIN_HOC: record.TIN_HOC,
        GIAO_DUC_CONG_DAN: record.GIAO_DUC_CONG_DAN,
        CN_CONG_NGHIEP: record.CN_CONG_NGHIEP,
        CN_NONG_NGHIEP: record.CN_NONG_NGHIEP,
        TONGDIEM: record.TONGDIEM
      };

      const { code, name } = getProvinceInfo(record.TinhId);
      const result = {
        student: examResult,
        province: name,
        provinceCode: code
      };

      res.json(result);
      return;
    }
    res.status(404).json({ error: 'SBD không hợp lệ' });
  } catch (error) {
    console.error('Error searching student:', error);
    res.status(500).json({ error: 'Lỗi server' });
    return;
  }
});

function getProvinceInfo(tinhId: number): { code: string; name: string } {
  const filePath = join(process.cwd(), 'assets', 'data.json');
  const provinceList = JSON.parse(readFileSync(filePath, 'utf-8'));

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

// API để lấy thống kê tổng hợp
app.get('/api/get-statistics', async (req, res) => {
  try {
    const { subject, limit = 10 } = req.query;
    const provincesPath = join(process.cwd(), 'assets', 'data.json');
    const provincesData = JSON.parse(readFileSync(provincesPath, 'utf-8'));

    const statistics = [];

    for (const province of provincesData) {
      try {
        const examPath = join(process.cwd(), 'assets', 'results', `exam_results_${province.ma_tinh}.json`);
        const examData = JSON.parse(readFileSync(examPath, 'utf-8'));

        const subjectStats = calculateSubjectStats(examData.data, subject as string);
        statistics.push({
          province: province.ten_tinh,
          provinceCode: province.ma_tinh,
          totalStudents: examData.total_records,
          ...subjectStats
        });
      } catch (error) {
        console.log(`File not found for province ${province.ma_tinh}`);
      }
    }

    // Sắp xếp theo điểm trung bình
    statistics.sort((a, b) => b.average - a.average);

    res.json(statistics.slice(0, parseInt(limit as string)));
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({ error: 'Error getting statistics' });
  }
});

// Hàm tính thống kê môn học
function calculateSubjectStats(data: any[], subject: string) {
  const scores = data
    .map(student => student[subject])
    .filter(score => score != null && score > 0);

  if (scores.length === 0) {
    return { average: 0, count: 0, max: 0, min: 0 };
  }

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const max = Math.max(...scores);
  const min = Math.min(...scores);

  return { average, count: scores.length, max, min };
}


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
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
