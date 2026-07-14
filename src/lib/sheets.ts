export interface ProductionRecord {
  id: string; // client-side tracking ID
  client: string; // 客戶名稱
  moldId: string; // 模具編號
  goodQty: number; // 良品數量
  badQty: number; // 不良品數量
  workHours: number; // 工時 (小時)
  operator: string; // 工作者
}

export interface SpreadsheetFile {
  id: string;
  name: string;
  webViewLink?: string;
}

/**
 * List spreadsheets from user's Google Drive.
 */
export async function listSpreadsheets(accessToken: string): Promise<SpreadsheetFile[]> {
  const query = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)&orderBy=modifiedTime desc&pageSize=20`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error?.message || "Failed to list spreadsheets from Google Drive.");
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Creates a brand new Google Sheet and initializes the headers.
 * Detects the default sheet's name dynamically to handle localization.
 */
export async function createSpreadsheet(
  accessToken: string,
  title: string
): Promise<{ id: string; name: string; webViewLink: string; defaultSheetName: string }> {
  // 1. Create Spreadsheet
  const createUrl = "https://sheets.googleapis.com/v4/spreadsheets";
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        title: title,
      },
    }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(errData?.error?.message || "Failed to create Google Sheet.");
  }

  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const webViewLink = sheetData.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  
  // Dynamically obtain the first sheet's title to bypass localization differences (e.g. Sheet1, 工作表1)
  const defaultSheetName = sheetData.sheets?.[0]?.properties?.title || "Sheet1";

  // 1.5 Make the spreadsheet publicly editable (Anyone with the link can edit)
  try {
    await shareSpreadsheetPublicly(accessToken, spreadsheetId);
  } catch (shareErr) {
    console.error("Error setting public permissions for spreadsheet:", shareErr);
    // We still proceed with writing headers and returning, but log the error
  }
 
  // 2. Write headers to the sheet
  const headers = [
    "客戶名稱",
    "模具編號",
    "良品數量",
    "不良品數量",
    "工時(小時)",
    "工作者",
    "記錄日期"
  ];

  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(defaultSheetName)}!A1:G1?valueInputOption=USER_ENTERED`;
  const updateRes = await fetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      values: [headers],
    }),
  });

  if (!updateRes.ok) {
    const errData = await updateRes.json().catch(() => ({}));
    throw new Error(errData?.error?.message || "Failed to write headers to the new spreadsheet.");
  }

  return {
    id: spreadsheetId,
    name: title,
    webViewLink,
    defaultSheetName,
  };
}

/**
 * Gets sheet title of the first sheet in a spreadsheet
 */
export async function getFirstSheetTitle(accessToken: string, spreadsheetId: string): Promise<string> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || "Failed to fetch spreadsheet details.";
    if (msg.toLowerCase().includes("permission") || errData?.error?.status === "PERMISSION_DENIED") {
      throw new Error("Google 試算表權限不足：主機 (Host) 尚未將此試算表設定為「知道連結的人均可編輯」，或是該網域禁止外部存取。請請主機手動至 Google 試算表開放編輯權限。");
    }
    throw new Error(msg);
  }

  const data = await response.json();
  return data.sheets?.[0]?.properties?.title || "Sheet1";
}

/**
 * Appends rows to a spreadsheet.
 */
export async function appendRecords(
  accessToken: string,
  spreadsheetId: string,
  records: Omit<ProductionRecord, "id">[]
): Promise<void> {
  // First, find the default sheet name
  const sheetTitle = await getFirstSheetTitle(accessToken, spreadsheetId);

  const timestamp = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const values = records.map((r) => [
    r.client,
    r.moldId,
    r.goodQty,
    r.badQty,
    r.workHours,
    r.operator,
    timestamp,
  ]);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}!A1:append?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      values,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || "Failed to append records to Google Sheet.";
    if (msg.toLowerCase().includes("permission") || errData?.error?.status === "PERMISSION_DENIED") {
      throw new Error("Google 試算表權限不足：主機 (Host) 尚未將此試算表設定為「知道連結的人均可編輯」，或是該網域禁止外部存取。請請主機手動至 Google 試算表開放編輯權限。");
    }
    throw new Error(msg);
  }
}

/**
 * Shares a file publicly so that anyone with the link can edit it.
 */
export async function shareSpreadsheetPublicly(accessToken: string, fileId: string): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "writer",
      type: "anyone",
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error?.message || "Failed to make spreadsheet publicly editable.");
  }
}

