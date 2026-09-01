"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/FAS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find(v => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function safeName(value) {
  return String(value || "document")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function extractJson(text) {
  const source = String(text || "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LLM 응답에서 JSON 객체를 찾지 못했습니다.");
  return JSON.parse(source.slice(start, end + 1));
}

async function approveDownloadsWithLlm(endpoint, model, year, pageNumber, headers, rows) {
  const payload = {
    year,
    page: pageNumber,
    headers,
    rows: rows.map((row, rowIndex) => ({
      row_index: rowIndex,
      number: row.number,
      product: row.product,
      available_documents: row.availableDocuments
    }))
  };
  const prompt = [
    "You are an insurance disclosure document download decision agent.",
    "Analyze the supplied table metadata and approve only 사업방법서 and 보험약관 documents that actually exist.",
    "Return one JSON object only, without markdown.",
    "Every approved row_index must exist in the input and every document_type must exist in available_documents.",
    "Required format:",
    '{"downloads":[{"row_index":0,"document_types":["사업방법서","보험약관"]}]}',
    "INPUT:",
    JSON.stringify(payload)
  ].join("\n");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`);
  const root = await response.json();
  const content = root?.choices?.[0]?.message?.content ?? root?.choices?.[0]?.text ?? "";
  const decision = extractJson(content);
  if (!Array.isArray(decision.downloads)) throw new Error("LLM 응답에 downloads 배열이 없습니다.");
  const approved = new Map();
  for (const item of decision.downloads) {
    const rowIndex = Number(item.row_index);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) throw new Error(`LLM row_index가 잘못되었습니다: ${item.row_index}`);
    const allowed = new Set(rows[rowIndex].availableDocuments);
    const docs = Array.isArray(item.document_types) ? item.document_types : [];
    const validated = docs.filter(v => (v === "사업방법서" || v === "보험약관") && allowed.has(v));
    if (validated.length) approved.set(rowIndex, new Set(validated));
  }
  return approved;
}

async function selectYear(page, year) {
  const filterButton = page.getByRole("button", { name: /전체.*전체.*전체/ }).first();
  await filterButton.click();
  const selects = page.locator("select");
  const count = await selects.count();
  let yearSelect = null;
  for (let i = 0; i < count; i++) {
    const candidate = selects.nth(i);
    const options = await candidate.locator("option").allTextContents();
    if (options.map(v => v.trim()).includes(year) && await candidate.isVisible()) {
      yearSelect = candidate;
      break;
    }
  }
  if (!yearSelect) throw new Error(`연도 ${year} 옵션이 있는 SELECT를 찾지 못했습니다.`);
  await yearSelect.selectOption({ label: year });
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await page.waitForTimeout(1200);
}

async function downloadViewerDocument(page, link, outputPath) {
  const popupPromise = page.waitForEvent("popup", { timeout: 15000 });
  await link.click();
  const popup = await popupPromise;
  try {
    await popup.waitForLoadState("domcontentloaded", { timeout: 30000 });
    const downloadButton = popup.frameLocator("#viewerFrame").getByRole("button", { name: "다운로드", exact: true });
    await downloadButton.waitFor({ state: "visible", timeout: 30000 });
    const downloadPromise = popup.waitForEvent("download", { timeout: 30000 });
    await downloadButton.click();
    const download = await downloadPromise;
    await download.saveAs(outputPath);
  } finally {
    await popup.close().catch(() => {});
  }
}

async function main() {
  const startUrl = arg("url", "https://www.samsunglife.com/individual/products/disclosure/sales/PDO-PRPRI010110M");
  const year = arg("year", "2024");
  const outputDir = path.resolve(arg("output", path.join(process.cwd(), "Downloads")));
  const maxPages = Number(arg("max-pages", "0"));
  const maxDocuments = Number(arg("max-documents", "0"));
  const dryRun = arg("dry-run", "false").toLowerCase() === "true";
  const useLlm = arg("use-llm", "true").toLowerCase() !== "false";
  const llmEndpoint = arg("llm-endpoint", "https://3ewe5z22ue1gso-8000.proxy.runpod.net/v1/chat/completions");
  const llmModel = arg("llm-model", "Qwen/Qwen3.5-27B");
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const manifest = [];
  let pageNumber = 1;
  let processedDocuments = 0;
  let stopRequested = false;

  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("heading", { name: "보험상품 목록" }).waitFor({ state: "visible", timeout: 60000 });
    await selectYear(page, year);

    while (true) {
      const table = page.getByRole("table", { name: /보험상품목록/ });
      const headers = (await table.locator("thead th").allTextContents()).map(v => v.trim());
      const businessIndex = headers.findIndex(v => v === "사업방법서");
      const termsIndex = headers.findIndex(v => v === "보험약관");
      if (businessIndex < 0 || termsIndex < 0) throw new Error("사업방법서 또는 보험약관 열을 찾지 못했습니다.");

      const rows = table.locator("tbody tr");
      const rowCount = await rows.count();
      console.log(`[PAGE ${pageNumber}] rows=${rowCount}`);

      const rowMetadata = [];
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const cells = rows.nth(rowIndex).locator("td");
        const availableDocuments = [];
        if (await cells.nth(businessIndex).locator("a").count()) availableDocuments.push("사업방법서");
        if (await cells.nth(termsIndex).locator("a").count()) availableDocuments.push("보험약관");
        rowMetadata.push({
          number: (await cells.nth(0).innerText()).trim(),
          product: (await cells.nth(2).innerText()).trim(),
          availableDocuments
        });
      }
      const approved = useLlm
        ? await approveDownloadsWithLlm(llmEndpoint, llmModel, year, pageNumber, headers, rowMetadata)
        : new Map(rowMetadata.map((row, index) => [index, new Set(row.availableDocuments)]));
      console.log(`[LLM PAGE ${pageNumber}] approved_rows=${approved.size}`);

      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const row = rows.nth(rowIndex);
        const cells = row.locator("td");
        const number = (await cells.nth(0).innerText()).trim();
        const product = (await cells.nth(2).innerText()).trim();
        for (const doc of [
          { type: "사업방법서", index: businessIndex },
          { type: "보험약관", index: termsIndex }
        ]) {
          if (!approved.has(rowIndex) || !approved.get(rowIndex).has(doc.type)) {
            manifest.push({ page: pageNumber, number, product, document_type: doc.type, status: "LLM_NOT_APPROVED" });
            continue;
          }
          const link = cells.nth(doc.index).locator("a").first();
          if (await link.count() === 0) {
            manifest.push({ page: pageNumber, number, product, document_type: doc.type, status: "SKIPPED", error: "링크 없음" });
            processedDocuments++;
            continue;
          }
          const fileName = `${safeName(number)}_${safeName(product)}_${doc.type}.pdf`;
          const filePath = path.join(outputDir, fileName);
          if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
            manifest.push({ page: pageNumber, number, product, document_type: doc.type, status: "EXISTS", file: filePath });
            continue;
          }
          if (dryRun) {
            manifest.push({ page: pageNumber, number, product, document_type: doc.type, status: "DRY_RUN", file: filePath });
          } else {
            try {
              console.log(`[DOWNLOAD] ${number} ${product} ${doc.type}`);
              await downloadViewerDocument(page, link, filePath);
              const size = fs.statSync(filePath).size;
              manifest.push({ page: pageNumber, number, product, document_type: doc.type, status: "SUCCESS", file: filePath, size });
            } catch (error) {
              manifest.push({ page: pageNumber, number, product, document_type: doc.type, status: "FAILED", error: error.message });
            }
          }
          processedDocuments++;
          fs.writeFileSync(path.join(outputDir, "download_manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
          if (maxDocuments > 0 && processedDocuments >= maxDocuments) { stopRequested = true; break; }
        }
        if (stopRequested) break;
      }

      if (stopRequested) break;
      if (maxPages > 0 && pageNumber >= maxPages) break;
      const next = page.locator("button.btn-paging-next").filter({ visible: true }).first();
      if (await next.count() === 0 || await next.isDisabled()) break;
      const previousFirstNumber = rowCount > 0 ? (await rows.nth(0).locator("td").nth(0).innerText()).trim() : "";
      await next.click();
      await page.waitForFunction(prev => {
        const first = document.querySelector("table tbody tr td");
        return first && String(first.textContent || "").trim() !== prev;
      }, previousFirstNumber, { timeout: 30000 });
      pageNumber++;
    }
  } finally {
    fs.writeFileSync(path.join(outputDir, "download_manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    await browser.close();
  }
  const failed = manifest.filter(x => x.status === "FAILED").length;
  console.log(`COMPLETE total=${manifest.length} failed=${failed} output=${outputDir}`);
  process.exitCode = failed > 0 ? 2 : 0;
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
