const TYPE_LABELS = {
  MOBILE: "Di động",
  LANDLINE: "Cố định",
  HOTLINE_1800: "Tổng đài 1800 (miễn phí)",
  HOTLINE_1900: "Tổng đài 1900",
  SHORT_CODE: "Đầu số ngắn",
  UNKNOWN: "Chưa xác định",
};

const IDENTITY_TYPE_LABELS = {
  PERSON: "Cá nhân",
  BUSINESS: "Doanh nghiệp",
  HOTLINE: "Tổng đài",
  ORGANIZATION: "Tổ chức",
  UNKNOWN: "Chưa xác định",
};

const CATEGORY_LABELS = {
  BANK: "Ngân hàng",
  INSURANCE: "Bảo hiểm",
  TELECOM: "Viễn thông",
  HOSPITAL: "Y tế",
  GOVERNMENT: "Nhà nước",
  DELIVERY: "Giao hàng",
  ECOMMERCE: "Thương mại điện tử",
  REAL_ESTATE: "Bất động sản",
  TELEMARKETING: "Telesale / Quảng cáo",
  SPAM: "Làm phiền",
  SCAM: "Lừa đảo",
  OTHER: "Khác",
};

const STATUS_LABELS = {
  CANDIDATE: "Chưa xác nhận",
  CONFIRMED: "Đã xác nhận",
  REJECTED: "Đã loại bỏ",
};

const form = document.getElementById("search-form");
const input = document.getElementById("phone-input");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const identitiesList = document.getElementById("identities-list");
const noIdentitiesEl = document.getElementById("no-identities");

function setStatus(kind, message) {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    return;
  }
  statusEl.hidden = false;
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });
}

function confidenceClass(confidence) {
  if (confidence >= 60) return "";
  if (confidence >= 30) return "warn";
  return "danger";
}

function renderResult(data) {
  resultEl.hidden = false;

  document.getElementById("result-phone").textContent =
    data.phone.normalized || data.phone.raw_input;

  document.getElementById("result-type").textContent =
    TYPE_LABELS[data.phone.type] || data.phone.type;

  const validBadge = document.getElementById("result-valid");
  validBadge.textContent = data.phone.valid ? "Hợp lệ" : "Chưa xác định định dạng";
  validBadge.className = data.phone.valid ? "badge" : "badge invalid";

  const stats = data.statistics;
  document.getElementById("stats-row").innerHTML = `
    <div><span class="stat-value">${stats.observation_count}</span>Lượt ghi nhận</div>
    <div><span class="stat-value">${stats.source_count}</span>Nguồn khác nhau</div>
    <div><span class="stat-value">${formatDate(stats.first_seen_at)}</span>Lần đầu thấy</div>
    <div><span class="stat-value">${formatDate(stats.last_seen_at)}</span>Lần gần nhất</div>
  `;

  identitiesList.innerHTML = "";
  if (data.identities.length === 0) {
    noIdentitiesEl.hidden = false;
  } else {
    noIdentitiesEl.hidden = true;
    for (const identity of data.identities) {
      const li = document.createElement("li");
      li.className = "identity-card";
      const category = identity.category ? CATEGORY_LABELS[identity.category] || identity.category : null;
      li.innerHTML = `
        <div class="identity-name">${escapeHtml(identity.name)}</div>
        <div class="identity-meta">
          <span>${IDENTITY_TYPE_LABELS[identity.type] || identity.type}</span>
          ${category ? `<span>${escapeHtml(category)}</span>` : ""}
          <span>${STATUS_LABELS[identity.status] || identity.status}</span>
          <span>${identity.evidence_count} bằng chứng</span>
          <span>Độ tin cậy: ${Math.round(identity.confidence)}%</span>
        </div>
        <div class="confidence-bar">
          <div class="confidence-bar-fill ${confidenceClass(identity.confidence)}" style="width:${Math.min(100, Math.max(0, identity.confidence))}%"></div>
        </div>
      `;
      identitiesList.appendChild(li);
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function lookupPhone(query) {
  setStatus("loading", "Đang tra cứu…");
  resultEl.hidden = true;

  try {
    const res = await fetch(`/api/v1/phones/${encodeURIComponent(query)}`);
    if (!res.ok) {
      setStatus("error", "Có lỗi xảy ra khi tra cứu, vui lòng thử lại.");
      return;
    }
    const data = await res.json();

    if (!data.phone.normalized) {
      setStatus("error", "Số điện thoại không đúng định dạng Việt Nam.");
      return;
    }

    if (data.statistics.observation_count === 0) {
      setStatus("empty", "Số này chưa có trong cơ sở dữ liệu (chưa từng được ghi nhận từ nguồn nào).");
      renderResult(data);
      return;
    }

    setStatus(null);
    renderResult(data);
  } catch (err) {
    setStatus("error", "Không kết nối được tới máy chủ, vui lòng thử lại sau.");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  lookupPhone(query);
});
