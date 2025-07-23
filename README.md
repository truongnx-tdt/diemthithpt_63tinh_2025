Dữ liệu được tổng hợp và tham khảo tại: https://github.com/harveycdr/DiemThiTHPT2025

web xem điểm: https://diemthithpt2025.tdtgalaxy.id.vn/

<img width="1391" height="952" alt="image" src="https://github.com/user-attachments/assets/b245a12f-a7d2-45fa-ae43-59d2330bb97a" />


# 🇻🇳 Crawl & Tổng hợp điểm thi THPT Quốc Gia 2025 - 63 Tỉnh Thành

Dự án này thực hiện **thu thập và tổng hợp dữ liệu điểm thi THPT Quốc Gia năm 2025** từ 63 tỉnh/thành trên cả nước, lưu trữ dưới định dạng JSON để phục vụ mục đích phân tích, thống kê hoặc nghiên cứu học thuật.

---

## 📁 Cấu trúc dữ liệu

### 1. `data.json`

Chứa danh sách mã tỉnh và tên đầy đủ của 63 tỉnh/thành:

```json
[
  {
    "ma_tinh": "01",
    "ten_tinh": "THÀNH PHỐ HÀ NỘI"
  }
]
```

### 2. `exam_results_01.json`

Là file dữ liệu điểm thi của từng tỉnh, ví dụ exam_results_01.json tương ứng với mã tỉnh 01 - THÀNH PHỐ HÀ NỘI. Cấu trúc gồm:

```json
{
  "province_code": "01",
  "province_name": "THÀNH PHỐ HÀ NỘI",
  "total_records": 122973,
  "expected_max_sbd": 125000,
  "coverage_percentage": 98.38,
  "export_time": "2025-07-21 08:51:59",
  "crawl_stats": {
    "total_requests": 124400,
    "successful_requests": 124394,
    "success_rate": 100,
    "failed_sbds": 0
  },
  "data": [
    {
      "SBD": "01000001",
      "TOAN": 5.75,
      "VAN": 7.75,
      "HOA": 7.75,
      "SINH": 8.25,
      "TONGDIEM": 29.5,
      ...
    }
  ]
}
Các môn không thi sẽ có giá trị là -1.

```

## 🎯 Mục tiêu dự án
Thu thập dữ liệu điểm thi công khai từ các Sở GD&ĐT.

Chuẩn hóa định dạng dữ liệu phục vụ:

Thống kê điểm theo tỉnh/thành

Phân tích xu hướng điểm thi

Ứng dụng học máy và AI trong phân tích dữ liệu giáo dục

Hỗ trợ cộng đồng học sinh, phụ huynh, giáo viên và lập trình viên.


## 📜 Giấy phép & Trách nhiệm
Dữ liệu được thu thập từ các nguồn công khai và sử dụng với mục đích phi thương mại. Vui lòng không sử dụng cho mục đích thương mại hoặc gây ảnh hưởng đến quyền riêng tư của thí sinh.

## 📬 Liên hệ
Nếu bạn muốn đóng góp, báo lỗi hoặc có nhu cầu sử dụng dữ liệu, hãy mở issue hoặc liên hệ qua GitHub.
