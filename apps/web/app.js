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

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = {
  lookup: document.getElementById("tab-lookup"),
  calllog: document.getElementById("tab-calllog"),
  ops: document.getElementById("tab-ops"),
};

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    Object.entries(tabPanels).forEach(([key, panel]) => {
      panel.hidden = key !== btn.dataset.tab;
    });
    if (btn.dataset.tab === "calllog") {
      loadSummary();
      loadUnknown();
    }
    if (btn.dataset.tab === "ops") {
      loadOpsStats();
      loadOpsJobs();
    }
  });
});

// ---------------------------------------------------------------------
// Call log import
// ---------------------------------------------------------------------
const importForm = document.getElementById("import-form");
const callDateInput = document.getElementById("call-date");
const callEntriesInput = document.getElementById("call-entries");
const importStatus = document.getElementById("import-status");
const importResult = document.getElementById("import-result");
const importResultList = document.getElementById("import-result-list");

function today() {
  return new Date().toISOString().slice(0, 10);
}
callDateInput.value = today();

function parseCallLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([+\d][\d\s.\-]*\d)\s*(?:[,xX*-]\s*(\d+))?\s*.*$/);
  if (!match) return null;
  const phone = match[1].replace(/\s+/g, " ").trim();
  const count = match[2] ? parseInt(match[2], 10) : 1;
  return { phone_raw: phone, call_count: count };
}

importForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const lines = callEntriesInput.value.split("\n");
  const entries = lines.map(parseCallLogLine).filter(Boolean);

  if (entries.length === 0) {
    importStatus.hidden = false;
    importStatus.className = "status error";
    importStatus.textContent = "Không đọc được số nào, kiểm tra lại định dạng.";
    return;
  }

  importStatus.hidden = false;
  importStatus.className = "status loading";
  importStatus.textContent = `Đang gửi ${entries.length} số…`;
  importResult.hidden = true;

  try {
    const res = await fetch("/api/v1/call-logs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_date: callDateInput.value, entries }),
    });
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();

    importStatus.className = "status";
    importStatus.textContent = `Đã lưu ${data.imported} số — biết ${data.known}, chưa biết ${data.unknown}.`;

    importResultList.innerHTML = "";
    for (const r of data.results) {
      const li = document.createElement("li");
      li.className = "identity-card";
      li.innerHTML = `
        <div class="identity-name">${escapeHtml(r.phoneRaw)}</div>
        <div class="identity-meta">
          <span>${r.known ? escapeHtml(r.identityName) : "Chưa biết"}</span>
          ${!r.valid ? "<span>Định dạng không chắc chắn</span>" : ""}
        </div>
      `;
      importResultList.appendChild(li);
    }
    importResult.hidden = false;
    callEntriesInput.value = "";

    loadSummary();
    loadUnknown();
  } catch (err) {
    importStatus.className = "status error";
    importStatus.textContent = "Gửi thất bại, thử lại sau.";
  }
});

// ---------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------
const summaryForm = document.getElementById("summary-form");
const summaryFromInput = document.getElementById("summary-from");
const summaryToInput = document.getElementById("summary-to");
const summaryTableWrap = document.getElementById("summary-table-wrap");

function defaultFromDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
summaryFromInput.value = defaultFromDate();
summaryToInput.value = today();

function renderPhoneTable(container, rows, columns, emptyMessage) {
  if (rows.length === 0) {
    container.innerHTML = `<p class="empty-note">${emptyMessage}</p>`;
    return;
  }
  const thead = `<tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td class="${c.cellClass || ""}">${c.render(row)}</td>`).join("")}</tr>`
    )
    .join("");
  container.innerHTML = `<div class="table-scroll"><table class="data-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

async function loadSummary() {
  summaryTableWrap.innerHTML = `<p class="empty-note">Đang tải…</p>`;
  try {
    const res = await fetch(
      `/api/v1/call-logs/summary?from=${summaryFromInput.value}&to=${summaryToInput.value}`
    );
    const data = await res.json();
    renderPhoneTable(
      summaryTableWrap,
      data.entries,
      [
        { label: "Số", cellClass: "phone-cell", render: (r) => escapeHtml(r.phoneRaw) },
        { label: "Số lần gọi", render: (r) => r.totalCalls },
        { label: "Số ngày", render: (r) => r.daysCalled },
        { label: "Lần gần nhất", render: (r) => r.lastCallDate },
        {
          label: "Nhận diện",
          render: (r) => (r.known ? escapeHtml(r.identityName) : '<span class="badge invalid">Chưa biết</span>'),
        },
      ],
      "Chưa có dữ liệu cuộc gọi trong khoảng thời gian này."
    );
  } catch (err) {
    summaryTableWrap.innerHTML = `<p class="empty-note">Không tải được dữ liệu.</p>`;
  }
}

summaryForm.addEventListener("submit", (e) => {
  e.preventDefault();
  loadSummary();
});

// ---------------------------------------------------------------------
// Unknown numbers list
// ---------------------------------------------------------------------
const unknownTableWrap = document.getElementById("unknown-table-wrap");

async function loadUnknown() {
  unknownTableWrap.innerHTML = `<p class="empty-note">Đang tải…</p>`;
  try {
    const res = await fetch("/api/v1/call-logs/unknown");
    const data = await res.json();
    renderPhoneTable(
      unknownTableWrap,
      data.entries,
      [
        { label: "Số", cellClass: "phone-cell", render: (r) => escapeHtml(r.phoneRaw) },
        { label: "Số lần gọi", render: (r) => r.totalCalls },
        { label: "Số ngày", render: (r) => r.daysCalled },
        { label: "Lần gần nhất", render: (r) => r.lastCallDate },
      ],
      "Không có số nào chưa xác định — tốt!"
    );
  } catch (err) {
    unknownTableWrap.innerHTML = `<p class="empty-note">Không tải được dữ liệu.</p>`;
  }
}

// ---------------------------------------------------------------------
// Operations (job queue) tab
// ---------------------------------------------------------------------
const opsStatusEl = document.getElementById("ops-status");
const opsStatsRow = document.getElementById("ops-stats-row");
const opsLiveness = document.getElementById("ops-liveness");
const opsJobsTableWrap = document.getElementById("ops-jobs-table-wrap");
const opsRefreshBtn = document.getElementById("ops-refresh");

function setOpsStatus(kind, message) {
  if (!message) {
    opsStatusEl.hidden = true;
    return;
  }
  opsStatusEl.hidden = false;
  opsStatusEl.className = `status ${kind}`;
  opsStatusEl.textContent = message;
}

async function loadOpsStats() {
  try {
    const res = await fetch("/api/v1/acquisition/job-stats");
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();

    opsStatsRow.innerHTML = `
      <div><span class="stat-value">${data.by_status.PENDING}</span>Đang chờ</div>
      <div><span class="stat-value">${data.by_status.RUNNING}</span>Đang chạy</div>
      <div><span class="stat-value">${data.by_status.RETRY}</span>Chờ thử lại</div>
      <div><span class="stat-value">${data.last_24h.completed}</span>Hoàn thành (24h)</div>
      <div><span class="stat-value">${data.last_24h.failed}</span>Thất bại (24h)</div>
    `;
    opsLiveness.textContent = data.last_job_started_at
      ? `Job gần nhất bắt đầu lúc: ${formatDate(data.last_job_started_at)} (không phải health-check thời gian thực -- chỉ là bằng chứng gần nhất worker đã chạy)`
      : "Chưa có job nào từng chạy.";
    setOpsStatus(null);
  } catch (err) {
    setOpsStatus("error", "Không tải được trạng thái hàng đợi.");
  }
}

async function loadOpsJobs() {
  opsJobsTableWrap.innerHTML = `<p class="empty-note">Đang tải…</p>`;
  try {
    const res = await fetch("/api/v1/acquisition/jobs?limit=20");
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    renderPhoneTable(
      opsJobsTableWrap,
      data.jobs,
      [
        { label: "Loại", render: (r) => escapeHtml(r.jobType) },
        { label: "Nguồn", render: (r) => escapeHtml(r.sourceName || "—") },
        { label: "Trạng thái", render: (r) => `<span class="status-pill ${r.status}">${r.status}</span>` },
        { label: "Lần thử", render: (r) => `${r.attemptCount}/${r.maxAttempts}` },
        { label: "Tạo lúc", render: (r) => formatDate(r.createdAt) },
        { label: "Lỗi gần nhất", render: (r) => (r.errorMessage ? escapeHtml(r.errorMessage) : "—") },
      ],
      "Chưa có job nào trong hàng đợi."
    );
  } catch (err) {
    opsJobsTableWrap.innerHTML = `<p class="empty-note">Không tải được dữ liệu.</p>`;
  }
}

opsRefreshBtn.addEventListener("click", () => {
  loadOpsStats();
  loadOpsJobs();
});
