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
    opsTabActive = btn.dataset.tab === "ops";
    if (opsTabActive) {
      loadOpsDashboard();
      startOpsAutoRefresh();
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
// Operations dashboard tab ("Vận hành")
// ---------------------------------------------------------------------
const opsStatusEl = document.getElementById("ops-status");
const opsLastUpdated = document.getElementById("ops-last-updated");
const opsJobsTableWrap = document.getElementById("ops-jobs-table-wrap");
const opsRefreshBtn = document.getElementById("ops-refresh");

let opsTabActive = false;
let opsRefreshTimer = null;
let growthChartRange = "24h";
let resourceChartRange = "24h";
const REFRESH_SECONDS = 60; // MONITORING_DASHBOARD_REFRESH_SECONDS default

function setOpsStatus(kind, message) {
  if (!message) {
    opsStatusEl.hidden = true;
    return;
  }
  opsStatusEl.hidden = false;
  opsStatusEl.className = `status ${kind}`;
  opsStatusEl.textContent = message;
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes) {
  if (bytes == null) return "—";
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
}

function renderBarChart(container, points, valueOf, maxValue, barClassOf) {
  if (points.length === 0) {
    container.innerHTML = `<p class="empty-note">Chưa có dữ liệu.</p>`;
    return;
  }
  const max = maxValue ?? Math.max(1, ...points.map(valueOf));
  container.innerHTML = points
    .map((p) => {
      const value = valueOf(p);
      const heightPct = Math.max(2, Math.round((value / max) * 100));
      const cls = barClassOf ? barClassOf(p) : "";
      return `<div class="bar-chart-col" title="${escapeHtml(String(value))}"><div class="bar-chart-bar ${cls}" style="height:${heightPct}%"></div></div>`;
    })
    .join("");
}

async function loadObservationAndData(summary) {
  const obs = summary.observation;
  const progressPct = obs.target_seconds > 0 ? Math.min(100, Math.round((obs.elapsed_seconds / obs.target_seconds) * 100)) : 0;
  document.getElementById("obs-progress-wrap").innerHTML = obs.started_at
    ? `<div class="progress-track"><div class="progress-fill" style="width:${progressPct}%"></div></div>`
    : `<p class="empty-note">Chưa bắt đầu chu kỳ quan sát (OBSERVATION_STARTED_AT chưa được đặt).</p>`;
  document.getElementById("obs-stats-row").innerHTML = `
    <div><span class="stat-value">${obs.started_at ? formatDate(obs.started_at) : "—"}</span>Bắt đầu</div>
    <div><span class="stat-value">${formatDuration(obs.elapsed_seconds)}</span>Đã trôi qua</div>
    <div><span class="stat-value">${formatDuration(obs.target_seconds)}</span>Mục tiêu</div>
    <div><span class="stat-value">${formatDuration(obs.remaining_seconds)}</span>Còn lại</div>
  `;

  const data = summary.data;
  document.getElementById("data-total").textContent = data.total_numbers.toLocaleString("vi-VN");
  document.getElementById("data-added-row").innerHTML = `
    <div><span class="stat-value">+${data.added["1h"]}</span>1 giờ</div>
    <div><span class="stat-value">+${data.added["3h"]}</span>3 giờ</div>
    <div><span class="stat-value">+${data.added["6h"]}</span>6 giờ</div>
    <div><span class="stat-value">+${data.added["9h"]}</span>9 giờ</div>
    <div><span class="stat-value">+${data.added["12h"]}</span>12 giờ</div>
    <div><span class="stat-value">+${data.added["24h"]}</span>24 giờ</div>
    <div><span class="stat-value">+${data.added.observation}</span>Từ khi quan sát</div>
  `;
}

async function loadGrowthChart() {
  const container = document.getElementById("growth-chart");
  try {
    const res = await fetch(`/api/v1/monitoring/data-growth?window=${growthChartRange}`);
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    renderBarChart(container, data.series, (p) => p.count);
  } catch (err) {
    container.innerHTML = `<p class="empty-note">Không tải được biểu đồ.</p>`;
  }
}

function loadPipeline(summary) {
  const jobs = summary.jobs;
  document.getElementById("pipeline-stats-row").innerHTML = `
    <div><span class="stat-value">${jobs.pending}</span>Đang chờ</div>
    <div><span class="stat-value">${jobs.running}</span>Đang chạy</div>
    <div><span class="stat-value">${jobs.completed}</span>Hoàn thành</div>
    <div><span class="stat-value">${jobs.failed}</span>Thất bại</div>
  `;
  document.getElementById("throughput-stats-row").innerHTML = `
    <div><span class="stat-value">${jobs.completed_1h}</span>Xong (1h)</div>
    <div><span class="stat-value">${jobs.completed_6h}</span>Xong (6h)</div>
    <div><span class="stat-value">${jobs.completed_24h}</span>Xong (24h)</div>
    <div><span class="stat-value">${jobs.average_duration_seconds}s</span>Thời gian TB</div>
    <div><span class="stat-value">${jobs.failed_1h}</span>Lỗi (1h)</div>
    <div><span class="stat-value">${jobs.failed_24h}</span>Lỗi (24h)</div>
  `;
}

async function loadRunningJobs() {
  const wrap = document.getElementById("running-jobs-wrap");
  try {
    const res = await fetch("/api/v1/monitoring/jobs");
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    if (data.running.length === 0) {
      wrap.innerHTML = `<p class="empty-note">Không có job nào đang chạy.</p>`;
      return;
    }
    wrap.innerHTML = data.running
      .map(
        (j) => `
        <div class="running-job-card">
          <strong>#${escapeHtml(String(j.id).slice(0, 8))}</strong> — ${escapeHtml(j.sourceName || j.jobType)}
          <div class="identity-meta">
            <span>Bắt đầu: ${formatDate(j.startedAt)}</span>
            <span>Đang chạy: ${formatDuration(j.durationSeconds)}</span>
            <span>Lần thử: ${j.attemptCount}/${j.maxAttempts}</span>
          </div>
        </div>`
      )
      .join("");
  } catch (err) {
    wrap.innerHTML = `<p class="empty-note">Không tải được dữ liệu.</p>`;
  }
}

function loadQueueHealth(summary) {
  const queue = summary.queue;
  const badge = document.getElementById("queue-status-badge");
  badge.textContent = queue.status;
  badge.className = `badge status-pill ${queue.status}`;

  const notes = {
    HEALTHY: "Hàng đợi đang được xử lý bình thường.",
    WARNING: "Job đang tồn đọng, cần theo dõi.",
    CRITICAL: "Hàng đợi tồn đọng nhiều hoặc job chờ quá lâu.",
  };
  document.getElementById("queue-status-note").textContent = notes[queue.status] || "";

  document.getElementById("queue-stats-row").innerHTML = `
    <div><span class="stat-value">${queue.pending}</span>Job chờ</div>
    <div><span class="stat-value">${queue.running}</span>Job chạy</div>
    <div><span class="stat-value">${formatDuration(queue.oldest_pending_age_seconds)}</span>Job chờ lâu nhất</div>
    <div><span class="stat-value">${queue.failed_24h}</span>Lỗi (24h)</div>
  `;
}

function loadVpsResources(summary) {
  const sys = summary.system;
  const wrap = document.getElementById("vps-stats-row");
  if (!sys) {
    wrap.innerHTML = `<p class="empty-note">Chưa có dữ liệu metrics collector (system-metrics.service).</p>`;
    return;
  }
  const memUsedPct = sys.memory_total_bytes > 0 ? Math.round(((sys.memory_total_bytes - sys.memory_available_bytes) / sys.memory_total_bytes) * 100) : 0;
  const diskUsedPct = sys.disk_total_bytes > 0 ? Math.round(((sys.disk_total_bytes - sys.disk_available_bytes) / sys.disk_total_bytes) * 100) : 0;
  wrap.innerHTML = `
    <div><span class="stat-value">${sys.cpu_percent != null ? sys.cpu_percent + "%" : "—"}</span>CPU</div>
    <div><span class="stat-value">${sys.load_1 ?? "—"}</span>Load 1m</div>
    <div><span class="stat-value">${formatBytes(sys.memory_total_bytes - sys.memory_available_bytes)} / ${formatBytes(sys.memory_total_bytes)}</span>RAM (${memUsedPct}%)</div>
    <div><span class="stat-value">${formatBytes(sys.disk_total_bytes - sys.disk_available_bytes)} / ${formatBytes(sys.disk_total_bytes)}</span>Disk (${diskUsedPct}%)</div>
  `;
}

async function loadResourceCharts() {
  const cpuContainer = document.getElementById("resource-chart-cpu");
  const memContainer = document.getElementById("resource-chart-mem");
  try {
    const res = await fetch(`/api/v1/monitoring/system-metrics?window=${resourceChartRange}`);
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    renderBarChart(
      cpuContainer,
      data.snapshots,
      (p) => (p.cpu_percent != null ? p.cpu_percent : 0),
      100,
      (p) => (p.cpu_percent >= 80 ? "danger" : p.cpu_percent >= 50 ? "warn" : "")
    );
    renderBarChart(
      memContainer,
      data.snapshots,
      (p) => (p.memory_total_bytes > 0 ? Math.round((p.memory_available_bytes / p.memory_total_bytes) * 100) : 0),
      100
    );
  } catch (err) {
    cpuContainer.innerHTML = `<p class="empty-note">Không tải được biểu đồ.</p>`;
    memContainer.innerHTML = "";
  }
}

async function loadOpsJobs() {
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

async function loadOpsDashboard() {
  try {
    const res = await fetch("/api/v1/monitoring/summary");
    if (!res.ok) throw new Error("bad response");
    const summary = await res.json();

    loadObservationAndData(summary);
    loadPipeline(summary);
    loadQueueHealth(summary);
    loadVpsResources(summary);

    setOpsStatus(null);
    opsLastUpdated.textContent = `Cập nhật lần cuối: ${new Date().toLocaleTimeString("vi-VN")}`;
  } catch (err) {
    // Keep whatever was last rendered on screen -- don't blank the dashboard.
    setOpsStatus("error", "Không tải được dữ liệu mới nhất, đang hiển thị dữ liệu cũ.");
  }

  loadGrowthChart();
  loadRunningJobs();
  loadResourceCharts();
  loadOpsJobs();
}

document.querySelectorAll(".chart-range-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chart-range-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    growthChartRange = btn.dataset.range;
    loadGrowthChart();
  });
});

document.querySelectorAll(".resource-range-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".resource-range-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    resourceChartRange = btn.dataset.range;
    loadResourceCharts();
  });
});

opsRefreshBtn.addEventListener("click", loadOpsDashboard);

function startOpsAutoRefresh() {
  if (opsRefreshTimer) return;
  opsRefreshTimer = setInterval(() => {
    if (opsTabActive) loadOpsDashboard();
  }, REFRESH_SECONDS * 1000);
}
