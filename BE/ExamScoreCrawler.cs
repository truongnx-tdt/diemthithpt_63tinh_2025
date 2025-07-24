using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

public class ProvinceConfig
{
    public string ProvinceName { get; set; }
    public int MaxSbd { get; set; }
    public int SegmentSize { get; set; }
    public ProvinceConfig(string name, int t, int s)
    {
        ProvinceName = name;
        MaxSbd = t;
        SegmentSize = s;
    }
}

public class ExamScoreCrawler
{
    private static readonly HttpClient httpClient = new HttpClient();
    private static readonly SemaphoreSlim semaphore = new SemaphoreSlim(30, 30); // Giảm concurrent requests
    private static readonly ConcurrentBag<ExamResult> currentProvinceResults = new ConcurrentBag<ExamResult>();
    static readonly Random random = new Random();

    // Cải tiến: Sử dụng ConcurrentQueue để quản lý retry tốt hơn
    static readonly ConcurrentQueue<string> failedSBDs = new ConcurrentQueue<string>();
    static readonly ConcurrentQueue<string> blockedSBDs = new ConcurrentQueue<string>(); // SBD bị block tạm thời

    // Monitoring và logging
    private static int totalRequests = 0;
    private static int successfulRequests = 0;
    private static int dataFoundRequests = 0; // Số request thực sự có dữ liệu
    private static DateTime lastLogTime = DateTime.Now;
    private static readonly object lockObject = new object();

    // Circuit breaker được cải tiến
    private static int consecutiveFailures = 0;
    private static int consecutiveEmptyResponses = 0; // Đếm response rỗng liên tiếp
    private static DateTime lastFailureTime = DateTime.MinValue;
    private static readonly int maxConsecutiveFailures = 15;
    private static readonly int maxConsecutiveEmptyForSegmentStop = 200; // Điều kiện dừng đoạn
    private static readonly TimeSpan circuitBreakerCooldown = TimeSpan.FromMinutes(3);

    static readonly string[] userAgents = new[]
    {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    };

    // Cấu hình segments động dựa theo tỉnh
    private static readonly Dictionary<string, ProvinceConfig> ProvinceConfigs = new Dictionary<string, ProvinceConfig>
    {
        ["01"] = new ProvinceConfig("Hà Nội", 125000, 5000), // 25 segments
        ["02"] = new ProvinceConfig("TP.HCM", 105000, 5000), // 21 segments  
    };

    private static readonly ProvinceConfig DefaultConfig = new ProvinceConfig("Default", 50000, 2500);

    public static async Task StartCrawl()
    {
        // Cấu hình HttpClient
        ConfigureHttpClient();

        // Tạo thư mục results nếu chưa có
        Directory.CreateDirectory("results");
        Directory.CreateDirectory("logs");

        // Đọc danh sách tỉnh từ file JSON
        string path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "data.json");
        string provincesJson = await File.ReadAllTextAsync(path);
        var provinces = JsonSerializer.Deserialize<List<Province>>(provincesJson);

        Console.WriteLine($"Bắt đầu crawl dữ liệu cho {provinces.Count} tỉnh...");

        // Kiểm tra tỉnh nào đã crawl xong
        var completedProvinces = GetCompletedProvinces();
        var remainingProvinces = provinces.Where(p => !completedProvinces.Contains(p.ma_tinh)).ToList();

        Console.WriteLine($"Đã hoàn thành: {completedProvinces.Count} tỉnh");
        Console.WriteLine($"Còn lại: {remainingProvinces.Count} tỉnh");

        // Crawl từng tỉnh một cách tuần tự
        foreach (var province in remainingProvinces)
        {
            try
            {
                await CrawlSingleProvince(province);
                Console.WriteLine($"✓ Hoàn thành tỉnh: {province.ten_tinh}");

                // Nghỉ giữa các tỉnh để tránh overload
                await Task.Delay(TimeSpan.FromSeconds(30));
            }
            catch (Exception ex)
            {
                Console.WriteLine($"✗ Lỗi khi crawl tỉnh {province.ten_tinh}: {ex.Message}");
                await LogError(province.ma_tinh, ex);
                continue;
            }
        }

        Console.WriteLine("Hoàn thành tất cả các tỉnh!");
        LogFinalStats();
    }

    private static void ConfigureHttpClient()
    {
        httpClient.DefaultRequestHeaders.Clear();
        httpClient.DefaultRequestHeaders.Add("accept", "application/json, text/plain, */*");
        httpClient.DefaultRequestHeaders.Add("accept-language", "vi-VN,vi;q=0.9,en;q=0.8");
        httpClient.DefaultRequestHeaders.Add("cache-control", "no-cache");
        httpClient.DefaultRequestHeaders.Add("origin", "https://tuoitre.vn");
        httpClient.DefaultRequestHeaders.Add("referer", "https://tuoitre.vn/");
        httpClient.DefaultRequestHeaders.Add("sec-ch-ua-mobile", "?0");
        httpClient.DefaultRequestHeaders.Add("sec-ch-ua-platform", "\"Windows\"");
        httpClient.DefaultRequestHeaders.Add("sec-fetch-dest", "empty");
        httpClient.DefaultRequestHeaders.Add("sec-fetch-mode", "cors");
        httpClient.DefaultRequestHeaders.Add("sec-fetch-site", "same-site");
        httpClient.Timeout = TimeSpan.FromSeconds(15);
    }

    private static void LogStats()
    {
        lock (lockObject)
        {
            var successRate = totalRequests > 0 ? (successfulRequests * 100.0 / totalRequests) : 0;
            var dataRate = successfulRequests > 0 ? (dataFoundRequests * 100.0 / successfulRequests) : 0;
            var timeSinceLastLog = DateTime.Now - lastLogTime;

            if (timeSinceLastLog.TotalMinutes >= 1)
            {
                Console.WriteLine($"[STATS] Total: {totalRequests} | Success: {successfulRequests} ({successRate:F1}%) | With Data: {dataFoundRequests} ({dataRate:F1}%) | Failures: {consecutiveFailures} | Empty: {consecutiveEmptyResponses}");
                lastLogTime = DateTime.Now;
            }
        }
    }

    private static void LogFinalStats()
    {
        var successRate = totalRequests > 0 ? (successfulRequests * 100.0 / totalRequests) : 0;
        var dataRate = successfulRequests > 0 ? (dataFoundRequests * 100.0 / successfulRequests) : 0;

        Console.WriteLine($"[FINAL STATS] Total requests: {totalRequests}");
        Console.WriteLine($"[FINAL STATS] Successful requests: {successfulRequests} ({successRate:F1}%)");
        Console.WriteLine($"[FINAL STATS] Requests with data: {dataFoundRequests} ({dataRate:F1}%)");
        Console.WriteLine($"[FINAL STATS] Failed SBDs in queue: {failedSBDs.Count}");
        Console.WriteLine($"[FINAL STATS] Blocked SBDs in queue: {blockedSBDs.Count}");
    }

    private static async Task<bool> IsCircuitBreakerOpen()
    {
        if (consecutiveFailures >= maxConsecutiveFailures)
        {
            var timeSinceLastFailure = DateTime.Now - lastFailureTime;
            if (timeSinceLastFailure < circuitBreakerCooldown)
            {
                var waitTime = circuitBreakerCooldown - timeSinceLastFailure;
                Console.WriteLine($"[CIRCUIT BREAKER] Tạm dừng {waitTime.TotalMinutes:F1} phút do quá nhiều lỗi.");
                await Task.Delay(waitTime);
            }

            consecutiveFailures = 0;
            Console.WriteLine("[CIRCUIT BREAKER] Reset, tiếp tục crawl.");
        }
        return false;
    }

    private static async Task<bool> HandleErrorResponse(HttpResponseMessage response, string sbd)
    {
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            Console.WriteLine($"[RATE LIMIT] {sbd} - Chờ 90 giây...");
            blockedSBDs.Enqueue(sbd);
            await Task.Delay(TimeSpan.FromSeconds(90));
            return true;
        }

        if (response.StatusCode == HttpStatusCode.Forbidden ||
            response.StatusCode == HttpStatusCode.ServiceUnavailable)
        {
            Console.WriteLine($"[BLOCKED] {sbd} - HTTP {(int)response.StatusCode} - Chờ 3 phút...");
            blockedSBDs.Enqueue(sbd);
            await Task.Delay(TimeSpan.FromMinutes(3));
            return true;
        }

        if ((int)response.StatusCode >= 500)
        {
            Console.WriteLine($"[SERVER ERROR] {sbd} - HTTP {(int)response.StatusCode}");
            failedSBDs.Enqueue(sbd);
            return false;
        }

        return false;
    }

    static HashSet<string> GetCompletedProvinces()
    {
        var completed = new HashSet<string>();
        if (Directory.Exists("results"))
        {
            var files = Directory.GetFiles("results", "exam_results_*.json");
            foreach (var file in files)
            {
                var fileName = Path.GetFileNameWithoutExtension(file);
                var provinceCode = fileName.Replace("exam_results_", "");
                completed.Add(provinceCode);
            }
        }
        return completed;
    }

    static async Task CrawlSingleProvince(Province province)
    {
        Console.WriteLine($"[START] Bắt đầu crawl tỉnh: {province.ten_tinh} ({province.ma_tinh})");

        // Reset counters cho tỉnh mới
        ResetProvinceCounters();

        var config = ProvinceConfigs.ContainsKey(province.ma_tinh)
            ? ProvinceConfigs[province.ma_tinh]
            : DefaultConfig;

        Console.WriteLine($"[CONFIG] {province.ten_tinh}: Max SBD = {config.MaxSbd:N0}, Segment size = {config.SegmentSize:N0}");

        var startTime = DateTime.Now;

        // Crawl dữ liệu cho tỉnh này
        await CrawlProvinceDataOptimized(province, config);

        // Xử lý retry tất cả SBD lỗi
        await ProcessAllFailedSBDs(province);

        // Xuất kết quả
        await ExportProvinceToJson(province, config);

        var duration = DateTime.Now - startTime;
        Console.WriteLine($"[DONE] {province.ten_tinh} - {duration.TotalMinutes:F1} phút - {currentProvinceResults.Count:N0} kết quả");
    }

    private static void ResetProvinceCounters()
    {
        currentProvinceResults.Clear();
        while (failedSBDs.TryDequeue(out _)) { }
        while (blockedSBDs.TryDequeue(out _)) { }
        totalRequests = 0;
        successfulRequests = 0;
        dataFoundRequests = 0;
        consecutiveFailures = 0;
        consecutiveEmptyResponses = 0;
    }

    static async Task CrawlProvinceDataOptimized(Province province, ProvinceConfig config)
    {
        // Tạo segments động
        var segments = CreateDynamicSegments(config);

        Console.WriteLine($"[{province.ten_tinh}] Tạo {segments.Count} segments");

        // Xử lý tối đa 3 segments đồng thời
        var segmentSemaphore = new SemaphoreSlim(3, 3);

        var segmentTasks = segments.Select(async (segment, index) =>
        {
            await segmentSemaphore.WaitAsync();
            try
            {
                Console.WriteLine($"[{province.ten_tinh}] Bắt đầu Segment {index + 1}/{segments.Count}: {segment.Start:N0}-{segment.End:N0}");

                var result = await CrawlSegmentWithEarlyStop(province, segment, $"S{index + 1}");

                Console.WriteLine($"[{province.ten_tinh}] {(result.CompletedFully ? "Hoàn thành" : "Dừng sớm")} Segment {index + 1}: {result.ResultsFound:N0} kết quả");

                return result;
            }
            finally
            {
                segmentSemaphore.Release();
            }
        });

        var results = await Task.WhenAll(segmentTasks);

        var totalResults = results.Sum(r => r.ResultsFound);
        var completedSegments = results.Count(r => r.CompletedFully);

        Console.WriteLine($"[{province.ten_tinh}] Tổng kết segments: {completedSegments}/{segments.Count} hoàn thành, {totalResults:N0} kết quả");
    }

    private static List<SegmentConfig> CreateDynamicSegments(ProvinceConfig config)
    {
        var segments = new List<SegmentConfig>();

        for (int start = 0; start < config.MaxSbd; start += config.SegmentSize)
        {
            int end = Math.Min(start + config.SegmentSize - 1, config.MaxSbd - 1);
            segments.Add(new SegmentConfig { Start = start, End = end });
        }

        return segments;
    }

    static async Task<SegmentResult> CrawlSegmentWithEarlyStop(Province province, SegmentConfig segment, string segmentName)
    {
        int batchSize = 100; // Tăng batch size để hiệu quả hơn
        int consecutiveEmptyBatches = 0;
        int maxEmptyBatches = 3; // Dừng sau 3 batch rỗng liên tiếp (300 SBD)
        int resultsFound = 0;
        int initialCount = currentProvinceResults.Count;

        for (int i = segment.Start; i <= segment.End; i += batchSize)
        {
            // Kiểm tra circuit breaker
            await IsCircuitBreakerOpen();

            int batchStart = i;
            int batchEnd = Math.Min(i + batchSize - 1, segment.End);

            int batchInitialCount = currentProvinceResults.Count;
            await ProcessBatchOptimized(province.ma_tinh, batchStart, batchEnd);
            int batchResults = currentProvinceResults.Count - batchInitialCount;

            if (batchResults > 0)
            {
                consecutiveEmptyBatches = 0;
                consecutiveEmptyResponses = 0; // Reset khi có dữ liệu
                Console.WriteLine($"[{province.ten_tinh}] [{segmentName}] Batch {batchStart:N0}-{batchEnd:N0}: +{batchResults} kết quả");
            }
            else
            {
                consecutiveEmptyBatches++;
                Console.WriteLine($"[{province.ten_tinh}] [{segmentName}] Batch {batchStart:N0}-{batchEnd:N0}: Rỗng ({consecutiveEmptyBatches}/{maxEmptyBatches})");

                // Dừng sớm nếu quá nhiều batch rỗng liên tiếp
                if (consecutiveEmptyBatches >= maxEmptyBatches)
                {
                    Console.WriteLine($"[{province.ten_tinh}] [{segmentName}] DỪNG SỚM - {consecutiveEmptyBatches} batch rỗng liên tiếp");
                    resultsFound = currentProvinceResults.Count - initialCount;
                    return new SegmentResult { ResultsFound = resultsFound, CompletedFully = false };
                }
            }

            LogStats();

            // Delay nhỏ giữa các batch
            await Task.Delay(random.Next(500, 1000));
        }

        resultsFound = currentProvinceResults.Count - initialCount;
        return new SegmentResult { ResultsFound = resultsFound, CompletedFully = true };
    }

    static async Task ProcessBatchOptimized(string provinceCode, int start, int end)
    {
        var tasks = new List<Task>();

        for (int i = start; i <= end; i++)
        {
            string sbd = $"{provinceCode}{i:D6}";
            tasks.Add(FetchStudentScoreOptimized(sbd));
        }

        await Task.WhenAll(tasks);
    }

    static async Task FetchStudentScoreOptimized(string sbd)
    {
        await semaphore.WaitAsync();

        try
        {
            // Random delay để tránh đồng loạt
            await Task.Delay(random.Next(50, 200));

            string url = $"https://s6.tuoitre.vn/api/diem-thi-thpt.htm?sbd={sbd}&year=2025";

            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.UserAgent.ParseAdd(userAgents[random.Next(userAgents.Length)]);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));

            Interlocked.Increment(ref totalRequests);

            using var response = await httpClient.SendAsync(request, cts.Token);

            if (response.IsSuccessStatusCode)
            {
                await ProcessSuccessResponse(response, sbd);
            }
            else
            {
                bool wasHandled = await HandleErrorResponse(response, sbd);
                if (!wasHandled)
                {
                    failedSBDs.Enqueue(sbd);
                }
                RecordFailure();
            }
        }
        catch (TaskCanceledException)
        {
            Console.WriteLine($"[TIMEOUT] {sbd}");
            failedSBDs.Enqueue(sbd);
            RecordFailure();
        }
        catch (HttpRequestException ex)
        {
            Console.WriteLine($"[NETWORK] {sbd}: {ex.Message}");
            failedSBDs.Enqueue(sbd);
            RecordFailure();
            await Task.Delay(1000); // Chờ khi có lỗi network
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ERROR] {sbd}: {ex.Message}");
            failedSBDs.Enqueue(sbd);
            RecordFailure();
        }
        finally
        {
            semaphore.Release();
        }
    }

    private static async Task ProcessSuccessResponse(HttpResponseMessage response, string sbd)
    {
        string jsonContent = await response.Content.ReadAsStringAsync();

        try
        {
            var apiResponse = JsonSerializer.Deserialize<ApiResponse>(jsonContent);

            if (apiResponse?.success == true && apiResponse.data?.Count > 0)
            {
                foreach (var result in apiResponse.data)
                {
                    currentProvinceResults.Add(result);
                }

                Interlocked.Increment(ref dataFoundRequests);
                consecutiveFailures = 0;
                consecutiveEmptyResponses = 0;

                // Chỉ log khi có dữ liệu để giảm spam
                if (random.Next(10) == 0) // Log 10% các success có dữ liệu
                {
                    Console.WriteLine($"✓ {sbd} (+{apiResponse.data.Count})");
                }
            }
            else
            {
                // API success nhưng không có dữ liệu
                Interlocked.Increment(ref consecutiveEmptyResponses);
            }

            Interlocked.Increment(ref successfulRequests);
        }
        catch (JsonException ex)
        {
            Console.WriteLine($"[JSON ERROR] {sbd}: {ex.Message}");
            failedSBDs.Enqueue(sbd);
            RecordFailure();
        }
    }

    private static void RecordFailure()
    {
        Interlocked.Increment(ref consecutiveFailures);
        lastFailureTime = DateTime.Now;
    }

    // Xử lý tất cả SBD lỗi với nhiều vòng retry
    static async Task ProcessAllFailedSBDs(Province province)
    {
        int maxRetryRounds = 5;
        int currentRound = 1;

        while ((failedSBDs.Count > 0 || blockedSBDs.Count > 0) && currentRound <= maxRetryRounds)
        {
            var totalToRetry = failedSBDs.Count + blockedSBDs.Count;
            Console.WriteLine($"[RETRY {currentRound}/{maxRetryRounds}] {province.ten_tinh}: {totalToRetry} SBD cần retry");

            if (totalToRetry == 0) break;

            // Xử lý blocked SBDs trước (chờ lâu hơn)
            await ProcessBlockedSBDs(province);

            // Sau đó xử lý failed SBDs
            await ProcessFailedSBDs(province);

            currentRound++;

            // Nghỉ giữa các vòng retry
            if (currentRound <= maxRetryRounds && (failedSBDs.Count > 0 || blockedSBDs.Count > 0))
            {
                var delayMinutes = currentRound * 2; // Tăng dần thời gian chờ
                Console.WriteLine($"[RETRY DELAY] Chờ {delayMinutes} phút trước vòng retry tiếp theo...");
                await Task.Delay(TimeSpan.FromMinutes(delayMinutes));
            }
        }

        // Log các SBD vẫn không thể lấy được
        if (failedSBDs.Count > 0 || blockedSBDs.Count > 0)
        {
            await LogPermanentlyFailedSBDs(province);
        }
    }

    static async Task ProcessBlockedSBDs(Province province)
    {
        var blockedList = new List<string>();
        while (blockedSBDs.TryDequeue(out string sbd))
        {
            blockedList.Add(sbd);
        }

        if (blockedList.Count == 0) return;

        Console.WriteLine($"[BLOCKED RETRY] {province.ten_tinh}: Retry {blockedList.Count} SBD bị block");

        // Retry blocked SBDs với delay lớn hơn
        foreach (var sbd in blockedList)
        {
            await RetryBlockedSBD(sbd);
            await Task.Delay(random.Next(2000, 4000)); // Delay lớn cho blocked SBDs
        }
    }

    static async Task ProcessFailedSBDs(Province province)
    {
        var failedList = new List<string>();
        while (failedSBDs.TryDequeue(out string sbd))
        {
            failedList.Add(sbd);
        }

        if (failedList.Count == 0) return;

        Console.WriteLine($"[FAILED RETRY] {province.ten_tinh}: Retry {failedList.Count} SBD lỗi");

        // Xử lý parallel với semaphore nhỏ hơn
        var retryTasks = failedList.Select(sbd => RetryFailedSBD(sbd));
        await Task.WhenAll(retryTasks);
    }

    static async Task RetryBlockedSBD(string sbd)
    {
        await semaphore.WaitAsync();
        try
        {
            await Task.Delay(random.Next(1000, 2000)); // Delay lớn cho blocked

            var success = await ExecuteRetryRequest(sbd);
            if (!success)
            {
                // Nếu vẫn lỗi, cho vào failed queue thay vì blocked
                failedSBDs.Enqueue(sbd);
            }
        }
        finally
        {
            semaphore.Release();
        }
    }

    static async Task RetryFailedSBD(string sbd)
    {
        await semaphore.WaitAsync();
        try
        {
            await Task.Delay(random.Next(500, 1500));

            var success = await ExecuteRetryRequest(sbd);
            if (!success)
            {
                failedSBDs.Enqueue(sbd); // Vẫn lỗi thì cho lại vào queue
            }
        }
        finally
        {
            semaphore.Release();
        }
    }

    static async Task<bool> ExecuteRetryRequest(string sbd)
    {
        try
        {
            string url = $"https://s6.tuoitre.vn/api/diem-thi-thpt.htm?sbd={sbd}&year=2025";

            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.UserAgent.ParseAdd(userAgents[random.Next(userAgents.Length)]);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            using var response = await httpClient.SendAsync(request, cts.Token);

            if (response.IsSuccessStatusCode)
            {
                string jsonContent = await response.Content.ReadAsStringAsync();
                var apiResponse = JsonSerializer.Deserialize<ApiResponse>(jsonContent);

                if (apiResponse?.success == true && apiResponse.data?.Count > 0)
                {
                    foreach (var result in apiResponse.data)
                    {
                        currentProvinceResults.Add(result);
                    }
                    Console.WriteLine($"[RETRY SUCCESS] {sbd}");
                    return true;
                }

                return true; // Success nhưng không có data cũng coi là thành công
            }
            else
            {
                // Check nếu vẫn bị block
                if (response.StatusCode == HttpStatusCode.TooManyRequests ||
                    response.StatusCode == HttpStatusCode.Forbidden)
                {
                    blockedSBDs.Enqueue(sbd);
                    return false;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[RETRY ERROR] {sbd}: {ex.Message}");
        }

        return false;
    }

    static async Task LogPermanentlyFailedSBDs(Province province)
    {
        var allFailed = new List<string>();

        while (failedSBDs.TryDequeue(out string sbd))
            allFailed.Add(sbd);

        while (blockedSBDs.TryDequeue(out string sbd))
            allFailed.Add(sbd);

        if (allFailed.Count > 0)
        {
            allFailed.Sort();
            var logContent = string.Join("\n", allFailed);
            await File.WriteAllTextAsync($"logs/permanent_failed_{province.ma_tinh}_{DateTime.Now:yyyyMMdd_HHmmss}.txt", logContent);

            Console.WriteLine($"[PERMANENT FAILED] {province.ten_tinh}: {allFailed.Count} SBD không thể lấy được dữ liệu");
        }
    }

    static async Task LogError(string provinceCode, Exception ex)
    {
        var errorLog = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} - {provinceCode} - {ex.Message}\n{ex.StackTrace}\n\n";
        await File.AppendAllTextAsync($"logs/errors_{DateTime.Now:yyyyMMdd}.log", errorLog);
    }
    static async Task ExportProvinceToJson(Province province, ProvinceConfig config)
    {
        var sortedResults = currentProvinceResults.OrderBy(r => r.SBD).ToList();

        var exportData = new
        {
            province_code = province.ma_tinh,
            province_name = province.ten_tinh,
            total_records = sortedResults.Count,
            expected_max_sbd = config.MaxSbd,
            coverage_percentage = Math.Round((sortedResults.Count * 100.0) / config.MaxSbd, 2),
            export_time = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            crawl_stats = new
            {
                total_requests = totalRequests,
                successful_requests = successfulRequests,
                success_rate = totalRequests > 0 ? Math.Round(successfulRequests * 100.0 / totalRequests, 2) : 0,
                failed_sbds = failedSBDs.Count
            },
            data = sortedResults
        };

        var options = new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };

        string json = JsonSerializer.Serialize(exportData, options);
        string fileName = $"results/exam_results_{province.ma_tinh}.json";
        await File.WriteAllTextAsync(fileName, json);

        Console.WriteLine($"Đã xuất {sortedResults.Count} kết quả tỉnh {province.ten_tinh} ra file {fileName}");
    }
}

public class SegmentResult
{
    public int ResultsFound { get; set; }
    public bool CompletedFully { get; set; }
}

// Các class model (giữ nguyên)
public class Province
{
    public string ma_tinh { get; set; }
    public string ten_tinh { get; set; }
}

public class ApiResponse
{
    public List<ExamResult> data { get; set; }
    public int total { get; set; }
    public bool success { get; set; }
}

public class ExamResult
{
    public string STT { get; set; }
    public string file_name { get; set; }
    public string modified_date { get; set; }
    public string Id { get; set; }
    public int TinhId { get; set; }
    public double DM1 { get; set; }
    public double DM2 { get; set; }
    public double DM3 { get; set; }
    public double DM4 { get; set; }
    public double DM5 { get; set; }
    public double DM6 { get; set; }
    public double DM7 { get; set; }
    public double DM8 { get; set; }
    public double DM9 { get; set; }
    public double DM10 { get; set; }
    public double DM11 { get; set; }
    public double DM12 { get; set; }
    public double DM13 { get; set; }
    public string MA_MON_NGOAI_NGU { get; set; }
    public string SBD { get; set; }
    public double TONGDIEM { get; set; }
    public double TOAN { get; set; }
    public double VAN { get; set; }
    public double NGOAI_NGU { get; set; }
    public double SU { get; set; }
    public double DIA { get; set; }
    public double GDKT_PL { get; set; }
    public double LI { get; set; }
    public double HOA { get; set; }
    public double SINH { get; set; }
    public double TIN_HOC { get; set; }
    public double GIAO_DUC_CONG_DAN { get; set; }
    public double CN_CONG_NGHIEP { get; set; }
    public double CN_NONG_NGHIEP { get; set; }
    public string NGAY_SINH { get; set; }
}


public class SegmentConfig
{
    public int Start { get; set; }
    public int End { get; set; }
}