import React, { useState, useEffect, useRef } from "react";
import {
  FileSpreadsheet,
  Plus,
  Trash2,
  Upload,
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ExternalLink,
  PlusCircle,
  Database,
  Image as ImageIcon,
  Loader2,
  Info,
  CircleAlert,
  ChevronRight,
  TrendingUp,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Users,
  Share2,
  Copy,
  Check,
  Sparkles,
  Lock,
  Play
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { initAuth, googleSignIn, logout } from "./lib/auth";
import {
  ProductionRecord,
  SpreadsheetFile,
  listSpreadsheets,
  createSpreadsheet,
  appendRecords
} from "./lib/sheets";
import {
  createSession,
  getSession,
  updateSessionSheet,
  subscribeToSession,
  subscribeToRecords,
  saveRecordRow,
  deleteRecordRow,
  clearAllRecordsInSession,
  updateSessionImage
} from "./lib/collab";
import { User } from "firebase/auth";
import heic2any from "heic2any";

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // Spreadsheets state
  const [driveSheets, setDriveSheets] = useState<SpreadsheetFile[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<SpreadsheetFile | null>(null);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  
  // Custom new spreadsheet state
  const [newSheetTitle, setNewSheetTitle] = useState("");
  const [isCreatingSheet, setIsCreatingSheet] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Records state
  const [records, setRecords] = useState<ProductionRecord[]>([]);

  // Image Upload state
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConvertingHeic, setIsConvertingHeic] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Sync state
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedCount, setLastSavedCount] = useState(0);
  const [savedSpreadsheetLink, setSavedSpreadsheetLink] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dialog state replacements for window.alert and window.confirm
  const [alertDialog, setAlertDialog] = useState<{ title: string; message: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const triggerAlert = (title: string, message: string) => {
    setAlertDialog({ title, message });
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ title, message, onConfirm });
  };

  // Collaborative Editing States
  const [currentSessionCode, setCurrentSessionCode] = useState<string | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [isConnectingSession, setIsConnectingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionMetadata, setSessionMetadata] = useState<any | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Unsubscribe references for real-time listeners
  const sessionUnsubRef = useRef<(() => void) | null>(null);
  const recordsUnsubRef = useRef<(() => void) | null>(null);

  // Clean up on unmount or session change
  const cleanUpUnsubs = () => {
    if (sessionUnsubRef.current) {
      sessionUnsubRef.current();
      sessionUnsubRef.current = null;
    }
    if (recordsUnsubRef.current) {
      recordsUnsubRef.current();
      recordsUnsubRef.current = null;
    }
  };

  useEffect(() => {
    return () => cleanUpUnsubs();
  }, []);

  // Listen to URL parameter for ?code=ABCXYZ on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      setJoinCodeInput(code.toUpperCase());
    }
  }, []);

  // Auto-join if user signs in and URL contains code
  useEffect(() => {
    if (user && joinCodeInput && !currentSessionCode) {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code && code.toUpperCase() === joinCodeInput.toUpperCase()) {
        handleJoinSession(code.toUpperCase());
      }
    }
  }, [user, joinCodeInput]);

  const handleCreateSession = async () => {
    if (!user) {
      triggerAlert("提示", "請先登入 Google 帳號以發起共同編輯。");
      return;
    }
    setIsConnectingSession(true);
    setSessionError(null);
    try {
      const metadata = selectedSheet ? { sheetId: selectedSheet.id, sheetName: selectedSheet.name } : undefined;
      const code = await createSession(user, records, metadata);
      if (code) {
        setCurrentSessionCode(code);
        // Update URL
        const newUrl = `${window.location.origin}${window.location.pathname}?code=${code}`;
        window.history.pushState({ path: newUrl }, "", newUrl);
        startSessionListeners(code);
      } else {
        throw new Error("發起失敗，無法產生共同編輯代碼。");
      }
    } catch (err: any) {
      setSessionError(err.message || "發起共同編輯失敗");
    } finally {
      setIsConnectingSession(false);
    }
  };

  const handleJoinSession = async (codeToJoin?: string) => {
    const code = (codeToJoin || joinCodeInput).trim().toUpperCase();
    if (!code) {
      triggerAlert("提示", "請輸入有效的共同編輯代碼");
      return;
    }
    if (!user) {
      triggerAlert("提示", "請先登入 Google 帳號以加入共同編輯。");
      return;
    }
    setIsConnectingSession(true);
    setSessionError(null);
    try {
      const session = await getSession(code);
      if (session) {
        setCurrentSessionCode(code);
        setJoinCodeInput(code);
        // Update URL
        const newUrl = `${window.location.origin}${window.location.pathname}?code=${code}`;
        window.history.pushState({ path: newUrl }, "", newUrl);
        startSessionListeners(code);
      } else {
        setSessionError("找不到該共同編輯文件，請檢查代碼是否正確。");
      }
    } catch (err: any) {
      setSessionError(err.message || "加入共同編輯失敗");
    } finally {
      setIsConnectingSession(false);
    }
  };

  const handleExitSession = () => {
    cleanUpUnsubs();
    setCurrentSessionCode(null);
    setSessionMetadata(null);
    setJoinCodeInput("");
    setIsConnectingSession(false);
    // Remove URL param
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.pushState({ path: cleanUrl }, "", cleanUrl);
  };

  const startSessionListeners = (code: string) => {
    cleanUpUnsubs();

    // 1. Session Metadata snapshot
    sessionUnsubRef.current = subscribeToSession(
      code,
      (meta) => {
        setSessionMetadata(meta);
        if (meta.sheetId && meta.sheetName) {
          if (!selectedSheet || selectedSheet.id !== meta.sheetId) {
            setSelectedSheet({
              id: meta.sheetId,
              name: meta.sheetName,
              webViewLink: `https://docs.google.com/spreadsheets/d/${meta.sheetId}/edit`
            });
          }
        }
        // Sync the shared photo preview across all participants
        if (meta.activeImage) {
          setSelectedImage((prev) => (prev !== meta.activeImage ? meta.activeImage : prev));
          if (meta.activeImageName) {
            setImageFile((prev) => {
              if (prev && prev.name === meta.activeImageName) return prev;
              const type = meta.activeImage.split(";")[0].split(":")[1] || "image/jpeg";
              return new File([], meta.activeImageName, { type });
            });
          }
        } else {
          setSelectedImage(null);
          setImageFile(null);
        }
      },
      (err) => {
        setSessionError("共同編輯已結束或發生錯誤：" + err.message);
        setIsConnectingSession(false);
        handleExitSession();
      }
    );

    // 2. Records snapshot
    recordsUnsubRef.current = subscribeToRecords(
      code,
      (newRecords) => {
        setRecords(newRecords);
      },
      (err) => {
        setSessionError("資料同步中斷：" + err.message);
        setIsConnectingSession(false);
      }
    );
  };

  const handleCopyLink = () => {
    if (!currentSessionCode) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?code=${currentSessionCode}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  // Initialize auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setAccessToken(token);
        setNeedsAuth(false);
        setIsAuthChecking(false);
        fetchSpreadsheets(token);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
        setIsAuthChecking(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const fetchSpreadsheets = async (token: string) => {
    setIsLoadingSheets(true);
    try {
      const sheets = await listSpreadsheets(token);
      setDriveSheets(sheets);
      if (sheets.length > 0 && !selectedSheet) {
        setSelectedSheet(sheets[0]);
      }
    } catch (err) {
      console.error("Failed to fetch spreadsheets:", err);
    } finally {
      setIsLoadingSheets(false);
    }
  };

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setAccessToken(res.accessToken);
        setNeedsAuth(false);
        fetchSpreadsheets(res.accessToken);
      }
    } catch (err: any) {
      console.error("Sign-in failed", err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    triggerConfirm("登出確認", "確定要登出 Google 帳號嗎？", async () => {
      try {
        await logout();
        setUser(null);
        setAccessToken(null);
        setDriveSheets([]);
        setSelectedSheet(null);
        setRecords([]);
        setNewSheetTitle("");
        setSelectedImage(null);
        setImageFile(null);
        setAnalysisResult(null);
        setNeedsAuth(true);
        handleExitSession();
      } catch (err) {
        console.error("Sign out failed", err);
      }
    });
  };

  const handleOpenSheet = async (sheetToOpen?: any) => {
    const target = sheetToOpen || selectedSheet;
    if (!target) {
      triggerAlert("提示", "請先選擇一筆試算表");
      return;
    }
    if (!user) {
      triggerAlert("提示", "請先登入 Google 帳號以啟用紀錄表。");
      return;
    }
    setIsConnectingSession(true);
    setSessionError(null);
    try {
      const code = await createSession(user, records, { sheetId: target.id, sheetName: target.name });
      if (code) {
        setCurrentSessionCode(code);
        // Update URL
        const newUrl = `${window.location.origin}${window.location.pathname}?code=${code}`;
        window.history.pushState({ path: newUrl }, "", newUrl);
        startSessionListeners(code);
      } else {
        throw new Error("無法產生共同編輯代碼");
      }
    } catch (err: any) {
      setSessionError(err.message || "開啟紀錄表失敗");
    } finally {
      setIsConnectingSession(false);
    }
  };

  const handleCreateSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    
    const title = newSheetTitle.trim();
    if (!title) {
      triggerAlert("提示", "請輸入試算表名稱");
      return;
    }

    setIsCreatingSheet(true);
    try {
      const newSheet = await createSpreadsheet(accessToken, title);
      setDriveSheets((prev) => [newSheet, ...prev]);
      setSelectedSheet(newSheet);
      setNewSheetTitle("");
      setShowCreateModal(false);
      
      // Auto dismiss success messages
      setSaveSuccess(false);

      // Automatically initialize/open the sheet to start collaborative editing
      if (user) {
        setIsConnectingSession(true);
        const code = await createSession(user, [], { sheetId: newSheet.id, sheetName: newSheet.name });
        if (code) {
          setCurrentSessionCode(code);
          const newUrl = `${window.location.origin}${window.location.pathname}?code=${code}`;
          window.history.pushState({ path: newUrl }, "", newUrl);
          startSessionListeners(code);
        }
      }
    } catch (err: any) {
      triggerAlert("建立試算表失敗", err.message || "發生未知錯誤");
    } finally {
      setIsCreatingSheet(false);
      setIsConnectingSession(false);
    }
  };

  // Image Selection Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileChange(e.target.files[0]);
    }
  };

  const compressImage = (base64Str: string, mimeType: string, maxWidth = 800, maxHeight = 800): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL(mimeType, 0.7));
        } else {
          resolve(base64Str);
        }
      };
      img.onerror = () => {
        resolve(base64Str);
      };
    });
  };

  const handleFileChange = (file: File) => {
    if (!file) return;

    const isHeic =
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif") ||
      file.type === "image/heic" ||
      file.type === "image/heif";

    if (!isHeic && !file.type.startsWith("image/")) {
      triggerAlert("提示", "請上傳圖片檔案 (PNG, JPG, JPEG, WEBP, HEIC)");
      return;
    }

    const proceedWithFile = (imgFile: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const result = e.target?.result as string;
        setAnalysisError(null);
        setSaveSuccess(false);

        let finalImage = result;
        try {
          finalImage = await compressImage(result, imgFile.type);
        } catch (err) {
          console.error("Image compression failed, using original", err);
        }

        setSelectedImage(finalImage);
        setImageFile(imgFile);

        if (currentSessionCode) {
          try {
            await updateSessionImage(currentSessionCode, finalImage, imgFile.name);
          } catch (err: any) {
            console.error("Failed to sync image to session", err);
          }
        }
      };
      reader.readAsDataURL(imgFile);
    };

    if (isHeic) {
      setIsConvertingHeic(true);
      setAnalysisError(null);
      heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.8
      })
        .then((result) => {
          const resultBlob = Array.isArray(result) ? result[0] : result;
          const convertedFile = new File(
            [resultBlob],
            file.name.replace(/\.(heic|heif)$/i, ".jpg"),
            { type: "image/jpeg" }
          );
          setIsConvertingHeic(false);
          proceedWithFile(convertedFile);
        })
        .catch((err) => {
          console.error("HEIC conversion failed:", err);
          setAnalysisError("HEIC/HEIF 轉換失敗，請嘗試改用 PNG 或 JPG 格式。");
          setIsConvertingHeic(false);
        });
    } else {
      proceedWithFile(file);
    }
  };

  const handleAnalyzeImage = async () => {
    if (!selectedImage || !imageFile) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const base64Parts = selectedImage.split(",");
      const rawBase64 = base64Parts[1];
      const mimeType = imageFile?.type || selectedImage.split(";")[0].split(":")[1] || "image/jpeg";

      const res = await fetch("/api/analyze-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: rawBase64,
          mimeType: mimeType,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "辨識工時相片時發生錯誤，請重試。");
      }

      const data = await res.json();
      if (data.success && Array.isArray(data.records)) {
        const recordsWithIds = data.records.map((r: any) => ({
          id: Math.random().toString(36).substring(2, 9),
          client: r.client || "",
          moldId: r.moldId || "",
          goodQty: typeof r.goodQty === "number" ? r.goodQty : parseInt(r.goodQty) || 0,
          badQty: typeof r.badQty === "number" ? r.badQty : parseInt(r.badQty) || 0,
          workHours: typeof r.workHours === "number" ? r.workHours : parseFloat(r.workHours) || 0,
          operator: r.operator || "",
        }));

        if (currentSessionCode) {
          let orderOffset = records.length;
          for (const newRec of recordsWithIds) {
            await saveRecordRow(currentSessionCode, newRec, orderOffset++);
          }
        } else {
          setRecords((prev) => [...prev, ...recordsWithIds]);
        }
      } else {
        throw new Error("伺服器回傳格式不正確。");
      }
    } catch (err: any) {
      setAnalysisError(err.message || "分析圖片失敗");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRecordChange = async (
    id: string,
    field: keyof Omit<ProductionRecord, "id">,
    value: any
  ) => {
    if (currentSessionCode) {
      const target = records.find((r) => r.id === id);
      if (target) {
        const order = records.indexOf(target);
        const updated = { ...target, [field]: value };
        await saveRecordRow(currentSessionCode, updated, order);
      }
    } else {
      setRecords((prev) =>
        prev.map((rec) => {
          if (rec.id === id) {
            return { ...rec, [field]: value };
          }
          return rec;
        })
      );
    }
  };

  const handleNumberChange = (
    id: string,
    field: "goodQty" | "badQty" | "workHours",
    valStr: string
  ) => {
    const val = valStr === "" ? 0 : field === "workHours" ? parseFloat(valStr) : parseInt(valStr, 10);
    handleRecordChange(id, field, isNaN(val) ? 0 : val);
  };

  const handleAddManualRow = async () => {
    const newRow: ProductionRecord = {
      id: Math.random().toString(36).substring(2, 9),
      client: "",
      moldId: "",
      goodQty: 0,
      badQty: 0,
      workHours: 0,
      operator: "",
    };
    if (currentSessionCode) {
      await saveRecordRow(currentSessionCode, newRow, records.length);
    } else {
      setRecords((prev) => [...prev, newRow]);
    }
    setSaveSuccess(false);
  };

  const handleRemoveRow = async (id: string) => {
    if (currentSessionCode) {
      await deleteRecordRow(currentSessionCode, id);
    } else {
      setRecords((prev) => prev.filter((rec) => rec.id !== id));
    }
  };

  const handleClearRecords = () => {
    triggerConfirm("清除確認", "確定要清除目前工作列表中的所有紀錄嗎？", async () => {
      if (currentSessionCode) {
        const ids = records.map((r) => r.id);
        await clearAllRecordsInSession(currentSessionCode, ids);
      } else {
        setRecords([]);
      }
    });
  };

  const handleSaveToSheet = () => {
    if (!accessToken || !selectedSheet) {
      triggerAlert("提示", "請先登入 Google 帳號，並選擇目標 Google 試算表。");
      return;
    }
    if (records.length === 0) {
      triggerAlert("提示", "工作列表中沒有紀錄可儲存，請先上傳相片識別或手動新增。");
      return;
    }

    // MANDATORY Workspace integration confirm prompt
    const confirmMessage = `確認要將這 ${records.length} 筆生產工時紀錄寫入至試算表「${selectedSheet.name}」嗎？\n資料會被追加到表格底部。`;
    triggerConfirm("確認寫入試算表", confirmMessage, async () => {
      setIsSaving(true);
      setSaveSuccess(false);
      setSaveError(null);

      try {
        await appendRecords(accessToken, selectedSheet.id, records);
        setLastSavedCount(records.length);
        setSavedSpreadsheetLink(selectedSheet.webViewLink || null);
        setSaveSuccess(true);
        
        // Clear the records array to complete the operational cycle
        if (currentSessionCode) {
          const ids = records.map((r) => r.id);
          await clearAllRecordsInSession(currentSessionCode, ids);
          await updateSessionImage(currentSessionCode, null, null);
        } else {
          setRecords([]);
        }
        setSelectedImage(null);
        setImageFile(null);
      } catch (err: any) {
        setSaveError(err.message || "儲存資料到 Google Sheets 時發生錯誤。");
      } finally {
        setIsSaving(false);
      }
    });
  };

  // Summary Metrics calculations
  const totalGood = records.reduce((sum, r) => sum + r.goodQty, 0);
  const totalBad = records.reduce((sum, r) => sum + r.badQty, 0);
  const totalQty = totalGood + totalBad;
  const totalHours = records.reduce((sum, r) => sum + r.workHours, 0);
  const yieldRate = totalQty > 0 ? ((totalGood / totalQty) * 100).toFixed(1) : "100.0";

  return (
    <div id="app-container" className="min-h-screen bg-[#0A0A0B] text-[#E0E0E0] selection:bg-indigo-900/40 font-sans antialiased">
      {/* Top Banner Navigation bar */}
      <header id="header-bar" className="sticky top-0 z-40 bg-[#0E0E10] border-b border-[#1F1F22] shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-[#00E5FF] to-[#4F46E5] rounded-lg text-white flex items-center justify-center shadow-md">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-display text-white tracking-tight flex items-center gap-2">
                ProductionSync <span className="text-[#71717A] text-xs font-normal bg-[#1F1F22] px-2 py-0.5 rounded-md border border-[#2A2A2E]">v2.4</span>
              </h1>
              <p className="text-xs text-[#71717A] hidden sm:block">
                智慧 AI 相片辨識 &middot; 統整匯出至 Google 試算表 &middot; 手動調校工具
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {isAuthChecking ? (
              <span className="text-xs text-[#71717A] flex items-center">
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> 正在確認授權...
              </span>
            ) : user ? (
              <div className="flex items-center space-x-3">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || "User avatar"}
                    className="w-8 h-8 rounded-full border border-[#2A2A2E]"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#1F1F22] border border-[#2A2A2E] text-xs font-semibold text-[#E0E0E0] flex items-center justify-center">
                    {user.displayName?.charAt(0) || "U"}
                  </div>
                )}
                <div className="hidden md:block text-right">
                  <p className="text-xs font-medium text-white leading-none">
                    {user.displayName}
                  </p>
                  <p className="text-[10px] text-[#71717A] leading-none mt-0.5">
                    {user.email}
                  </p>
                </div>
                <button
                  id="btn-signout"
                  onClick={handleSignOut}
                  className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-[#1F1F22] rounded-lg transition-colors border border-transparent hover:border-[#2A2A2E]"
                  title="登出帳號"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                id="btn-signin-header"
                onClick={handleSignIn}
                disabled={isLoggingIn}
                className="gsi-material-button text-xs py-1.5 px-3 border border-[#2A2A2E] rounded-lg bg-[#161618] hover:bg-[#1F1F22] flex items-center space-x-2 transition-colors disabled:opacity-50 text-[#E0E0E0]"
              >
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
                <span className="font-medium text-[#E0E0E0]">登入 Google 帳號</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Layout Stage */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <AnimatePresence mode="wait">
          {needsAuth ? (
            /* Authentication Wall Gate */
            <motion.div
              key="auth-wall"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="max-w-xl mx-auto my-12"
            >
              <div className="bg-[#0E0E10] rounded-2xl border border-[#1F1F22] shadow-md overflow-hidden p-8 text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-[#00E5FF] to-[#4F46E5] rounded-2xl text-white flex items-center justify-center mx-auto mb-6 shadow-inner">
                  <FileSpreadsheet className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold text-white font-display tracking-tight">
                  連結您的 Google 雲端硬碟與試算表
                </h2>
                <p className="text-[#A1A1AA] mt-3 text-sm leading-relaxed max-w-sm mx-auto">
                  此系統需要您授權存取 Google Sheets，方能建立紀錄表與直接統整寫入工時，您的所有存取均受 Google 安全防護認證。
                </p>

                <div className="mt-8">
                  <button
                    id="btn-signin-wall"
                    onClick={handleSignIn}
                    disabled={isLoggingIn}
                    className="w-full flex items-center justify-center space-x-3 py-3 px-4 bg-gradient-to-r from-indigo-600 to-[#4F46E5] hover:opacity-90 text-white font-medium rounded-xl transition-all shadow-sm disabled:opacity-50"
                  >
                    {isLoggingIn ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin text-white" />
                        <span>正在連結 Google 帳號...</span>
                      </>
                    ) : (
                      <>
                        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5 bg-white p-0.5 rounded-full">
                          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        </svg>
                        <span>透過 Google 安全登入</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="mt-6 flex items-center justify-center space-x-1.5 text-xs text-[#71717A]">
                  <Info className="w-3.5 h-3.5 text-[#00E5FF]" />
                  <span>支援傳統中文、各型工廠生產紀錄手寫與印刷單據識別</span>
                </div>
              </div>
            </motion.div>
          ) : (
            /* Application Core Panel Workspace */
            <motion.div
              key="app-workspace"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Status Alert for saving success */}
              {saveSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4 flex items-start space-x-3"
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="grow">
                    <h4 className="text-sm font-semibold text-emerald-200">匯出成功！</h4>
                    <p className="text-xs text-emerald-300 mt-1">
                      成功將 {lastSavedCount} 筆生產工時紀錄追加寫入至您的 Google 試算表中。
                    </p>
                    {savedSpreadsheetLink && (
                      <div className="mt-2.5">
                        <a
                          href={savedSpreadsheetLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-xs font-semibold text-emerald-200 hover:text-emerald-100 bg-emerald-900/30 hover:bg-emerald-900/50 px-3 py-1.5 rounded-lg transition-colors border border-emerald-800/50 shadow-3xs"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                          <span>在 Google 試算表中查看</span>
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Status Alert for errors */}
              {saveError && (
                <div className="bg-rose-950/30 border border-rose-800/40 rounded-xl p-4 flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-rose-200">儲存失敗</h4>
                    <p className="text-xs text-rose-300 mt-1 leading-relaxed">{saveError}</p>
                  </div>
                </div>
              )}

              {/* Three Split Windows/Panels Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* ========================================================= */}
                {/* PANEL 1: 開啟與建立紀錄表 */}
                {/* ========================================================= */}
                <div id="panel-1-management" className="lg:col-span-6 xl:col-span-3 bg-[#0D0D0F] border border-[#1F1F22] rounded-xl p-5 shadow-2xs space-y-4">
                  <div className="flex items-center space-x-2.5 pb-3 border-b border-[#1F1F22]">
                    <div className="p-2 bg-[#161618] border border-[#2A2A2E] rounded-lg text-[#00E5FF]">
                      <Database className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs uppercase tracking-widest font-bold text-[#A1A1AA]">
                        1. 紀錄表管理
                      </h3>
                      <p className="text-[10px] text-[#71717A] mt-0.5">開啟、建立或加入編輯</p>
                    </div>
                  </div>

                  {currentSessionCode ? (
                    /* Active Session View */
                    <div className="bg-[#091A14]/40 border border-emerald-950/50 rounded-xl p-4 space-y-3">
                      <div className="flex items-center space-x-2">
                        <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-xs font-semibold text-emerald-400">已開啟公開共同編輯</span>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] text-[#71717A] font-mono block">當前紀錄表名稱</span>
                        <span className="text-xs font-medium text-slate-200 block truncate">
                          {selectedSheet?.name || "共同編輯紀錄表"}
                        </span>
                        {selectedSheet?.webViewLink && (
                          <a
                            href={selectedSheet.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-[10px] text-[#00E5FF] hover:underline mt-1"
                          >
                            <ExternalLink className="w-3 h-3 mr-0.5" />
                            打開 Google Sheets
                          </a>
                        )}
                      </div>

                      <div className="bg-[#111114]/80 p-3 rounded-lg border border-[#222228] flex flex-col space-y-1.5 mt-2">
                        <span className="text-[10px] text-[#71717A] uppercase font-mono">共同編輯 6 位數代碼</span>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-extrabold text-emerald-400 font-mono tracking-widest bg-emerald-950/40 px-2.5 py-1 rounded border border-emerald-800/30">
                            {currentSessionCode}
                          </span>
                          <button
                            onClick={handleCopyLink}
                            className="flex items-center space-x-1 px-2 py-1.5 bg-[#1F1F22] hover:bg-[#2A2A2E] text-slate-300 hover:text-white rounded-md text-[10px] font-semibold transition-colors border border-[#2A2A2E] shrink-0"
                            title="複製分享連結"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span>已複製</span>
                              </>
                            ) : (
                              <>
                                <Share2 className="w-3 h-3" />
                                <span>複製</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={handleExitSession}
                        className="w-full mt-2 py-2 bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 rounded-lg text-xs font-semibold transition-colors border border-rose-900/30 cursor-pointer"
                      >
                        結束/關閉此紀錄表
                      </button>

                      <p className="text-[10px] text-[#52525B] text-center pt-1.5">
                        若要切換其它紀錄表，請先結束當前編輯。
                      </p>
                    </div>
                  ) : (
                    /* Inactive / Setup View */
                    <div className="space-y-4">
                      {/* Step 1: Open existing dropdown */}
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-[#A1A1AA]">選擇現有紀錄表</label>
                        <div className="flex items-center space-x-2">
                          <div className="relative grow">
                            <select
                              id="select-spreadsheet-panel"
                              value={selectedSheet?.id || ""}
                              onChange={(e) => {
                                const target = driveSheets.find((s) => s.id === e.target.value);
                                if (target) {
                                  setSelectedSheet(target);
                                }
                              }}
                              className="w-full text-xs bg-[#161618] border border-[#2A2A2E] hover:border-[#1F1F22] rounded-lg px-3 py-2 pr-8 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-medium text-[#E0E0E0] cursor-pointer appearance-none"
                              disabled={isLoadingSheets}
                            >
                              {driveSheets.length === 0 ? (
                                <option value="">-- 沒有可用的試算表 --</option>
                              ) : (
                                driveSheets.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))
                              )}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[#71717A]">
                              <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                            </div>
                          </div>
                          
                          <button
                            id="btn-refresh-sheets-panel"
                            onClick={() => accessToken && fetchSpreadsheets(accessToken)}
                            disabled={isLoadingSheets}
                            className="p-2 bg-[#161618] hover:bg-[#1F1F22] border border-[#2A2A2E] rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                            title="重新整理試算表清單"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSheets ? "animate-spin" : ""}`} />
                          </button>
                        </div>

                        <button
                          onClick={() => handleOpenSheet()}
                          disabled={isConnectingSession || !selectedSheet}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>開啟選取的紀錄表</span>
                        </button>
                      </div>

                      {/* Step 2: Create a new spreadsheet */}
                      <div className="pt-3 border-t border-[#1F1F22] space-y-1.5">
                        <span className="block text-[11px] text-[#71717A]">找不到檔案？</span>
                        <button
                          id="btn-create-sheet-panel"
                          onClick={() => setShowCreateModal(true)}
                          className="w-full py-2 bg-[#161618] hover:bg-[#1F1F22] border border-[#2A2A2E] text-slate-200 hover:text-white font-bold rounded-lg text-xs transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5 text-[#00E5FF]" />
                          <span>建立全新紀錄表</span>
                        </button>
                      </div>

                      {/* Step 3: Enter 6-digit Code to Join/Open */}
                      <div className="pt-3.5 border-t border-[#1F1F22] space-y-2">
                        <label className="block text-xs font-semibold text-[#A1A1AA]">
                          輸入 6 位數代碼開啟或加入共同編輯
                        </label>
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            placeholder="例如: ABCXYZ"
                            value={joinCodeInput}
                            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                            className="bg-[#161618] border border-[#2A2A2E] focus:border-indigo-500 rounded-lg px-3 py-2 text-xs w-full focus:outline-hidden font-mono tracking-wider text-white"
                            disabled={isConnectingSession}
                          />
                          <button
                            onClick={() => handleJoinSession()}
                            disabled={isConnectingSession || !joinCodeInput.trim()}
                            className="px-4 py-2 bg-[#00E5FF] text-black font-bold rounded-lg text-xs transition-colors hover:opacity-90 disabled:opacity-50 shrink-0 cursor-pointer shadow-sm"
                          >
                            {isConnectingSession ? "載入中..." : "開啟"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Session Error Alert in Panel 1 */}
                  {sessionError && (
                    <div className="mt-3 bg-rose-950/20 border border-rose-900/30 text-rose-400 rounded-lg px-3 py-2.5 text-xs flex items-center space-x-2">
                      <CircleAlert className="w-4 h-4 text-rose-400 shrink-0" />
                      <span className="text-[11px]">{sessionError}</span>
                    </div>
                  )}
                </div>
                {/* ========================================================= */}
                {/* PANEL 2: 上傳圖片辨識 */}
                {/* ========================================================= */}
                <div id="panel-2-upload-analysis" className="lg:col-span-6 xl:col-span-3 bg-[#0D0D0F] border border-[#1F1F22] rounded-xl p-5 shadow-2xs space-y-4">
                  <div className="flex items-center space-x-2.5 pb-3 border-b border-[#1F1F22]">
                    <div className="p-2 bg-[#161618] border border-[#2A2A2E] rounded-lg text-[#00E5FF]">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs uppercase tracking-widest font-bold text-[#A1A1AA]">
                        2. 上傳圖片辨識
                      </h3>
                      <p className="text-[10px] text-[#71717A] mt-0.5">匯入相片並利用 AI 辨識</p>
                    </div>
                  </div>

                  {!currentSessionCode ? (
                    /* Locked View */
                    <div className="py-12 px-4 text-center border border-dashed border-[#1F1F22] rounded-xl bg-[#0A0A0B]/60 flex flex-col items-center justify-center space-y-3">
                      <Lock className="w-8 h-8 text-[#52525B] mb-1" />
                      <h4 className="text-xs font-semibold text-[#E0E0E0]">相片功能尚未啟用</h4>
                      <p className="text-[11px] text-[#71717A] max-w-[220px] mx-auto leading-relaxed">
                        請先在 <strong className="text-indigo-400">[視窗 1]</strong> 選擇開啟紀錄表，或輸入 6 位數代碼開啟以解鎖此功能。
                      </p>
                    </div>
                  ) : (
                    /* Active Upload View */
                    <div className="space-y-4">
                      <div className="mb-1 px-3 py-2 bg-emerald-950/20 border border-emerald-500/10 rounded-lg text-emerald-400 text-[10px] font-medium flex items-center space-x-2">
                        <Users className="w-3.5 h-3.5 shrink-0 text-emerald-400 animate-pulse" />
                        <span>上傳相片將即時同步給所有成員</span>
                      </div>

                      {/* Drag and Drop Zone */}
                      <div
                        onDragEnter={handleDrag}
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all overflow-hidden ${
                          dragActive
                            ? "border-indigo-500 bg-indigo-950/20"
                            : selectedImage
                            ? "border-[#2A2A2E] bg-[#0A0A0B] hover:bg-[#161618]/30"
                            : "border-[#2A2A2E] hover:border-indigo-500 bg-[#0A0A0B] hover:bg-[#161618]/20"
                        }`}
                      >
                        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "radial-gradient(#E0E0E0 1px, transparent 1px)", backgroundSize: "20px 20px" }}></div>
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={onFileInputChange}
                          accept="image/*,.heic,.heif"
                          className="hidden"
                        />

                        {isConvertingHeic ? (
                          <div className="py-6 space-y-3 z-10 relative">
                            <Loader2 className="w-8 h-8 animate-spin text-[#00E5FF] mx-auto" />
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-[#E0E0E0]">
                                正在轉換 HEIC 格式...
                              </p>
                            </div>
                          </div>
                        ) : selectedImage ? (
                          <div className="space-y-3 z-10 relative">
                            <img
                              src={selectedImage}
                              alt="Preview of uploaded factory record sheet"
                              className="max-h-40 mx-auto rounded-lg object-contain shadow-2xl border border-[#1F1F22]"
                            />
                            <div className="text-[10px] text-[#A1A1AA] font-medium truncate max-w-xs mx-auto">
                              {imageFile?.name}
                            </div>
                            <p className="text-[9px] text-[#71717A]">
                              點擊或拖曳新圖片以進行更換
                            </p>
                          </div>
                        ) : (
                          <div className="py-4 space-y-3 z-10 relative">
                            <div className="w-10 h-10 bg-[#161618] border border-[#2A2A2E] rounded-xl flex items-center justify-center mx-auto text-slate-400">
                              <Upload className="w-5 h-5 text-[#71717A]" />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-[#E0E0E0]">
                                拖曳相片或點擊上傳
                              </p>
                              <p className="text-[9px] text-[#71717A]">
                                PNG, JPG, JPEG, WEBP, HEIC
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action buttons under upload zone */}
                      {selectedImage && (
                        <div className="space-y-2">
                          <button
                            id="btn-analyze-image"
                            onClick={handleAnalyzeImage}
                            disabled={isAnalyzing}
                            className="w-full py-2.5 px-4 bg-[#00E5FF] hover:opacity-90 text-black text-xs font-bold rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            {isAnalyzing ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-black" />
                                <span>正在讀取並精準辨識中...</span>
                              </>
                            ) : (
                              <>
                                <Database className="w-4 h-4 text-black" />
                                <span>辨識相片工時</span>
                              </>
                            )}
                          </button>
                          <button
                            id="btn-remove-preview-image"
                            onClick={async () => {
                              setSelectedImage(null);
                              setImageFile(null);
                              setAnalysisError(null);
                              if (currentSessionCode) {
                                try {
                                  await updateSessionImage(currentSessionCode, null, null);
                                } catch (err) {
                                  console.error("Failed to clear shared session image", err);
                                }
                              }
                            }}
                            className="w-full py-2 text-xs text-[#A1A1AA] hover:text-[#E0E0E0] font-medium bg-[#161618] hover:bg-[#1F1F22] rounded-xl border border-[#2A2A2E] transition-colors cursor-pointer"
                          >
                            清除相片
                          </button>
                        </div>
                      )}

                      {/* Diagnostics and Error Alerts */}
                      {analysisError && (
                        <div className="bg-rose-950/30 border border-rose-800/40 rounded-lg p-3 flex items-start space-x-2 text-rose-300 text-[10px] leading-relaxed">
                          <CircleAlert className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                          <span>辨識出錯: {analysisError}。請確保圖片清晰、對焦無偏並重試。</span>
                        </div>
                      )}

                      {/* Quick manual tips */}
                      <div className="bg-[#0E0E10] border border-[#1F1F22] rounded-xl p-3 text-[10px] text-[#71717A] space-y-1">
                        <div className="flex items-center space-x-1 font-semibold text-slate-300">
                          <Info className="w-3.5 h-3.5 text-[#00E5FF]" />
                          <span>相片辨識提示</span>
                        </div>
                        <ul className="list-disc pl-3.5 space-y-0.5">
                          <li>將工廠紀錄單平鋪於光線充足處拍攝。</li>
                          <li>AI 可自動提取表格、字體，並對應欄位。</li>
                          <li>辨識完可於右側工作區直接手動調整與刪改。</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>

                {/* ========================================================= */}
                {/* PANEL 3: 當前待統整的工作列表 */}
                {/* ========================================================= */}
                <div id="panel-3-work-list" className="lg:col-span-12 xl:col-span-6 bg-[#0D0D0F] border border-[#1F1F22] rounded-xl shadow-2xs overflow-hidden flex flex-col min-h-[460px]">
                  {!currentSessionCode ? (
                    /* Locked State */
                    <div className="flex flex-col items-center justify-center py-24 px-4 text-center grow">
                      <div className="w-14 h-14 bg-[#161618] border border-[#2A2A2E] rounded-2xl flex items-center justify-center text-[#71717A] mb-4">
                        <Lock className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-semibold text-[#E0E0E0]">工作列表尚未開啟</h4>
                      <p className="text-xs text-[#71717A] mt-1.5 max-w-sm">
                        目前尚未開啟任何紀錄表。請先在左側 <strong className="text-indigo-400">[視窗 1]</strong> 開啟/建立紀錄表，或輸入 6 位數代碼，即可解鎖並開始進行編輯與工時統整。
                      </p>
                    </div>
                  ) : (
                    /* Active Table list View */
                    <div className="flex flex-col grow">
                      {/* Panel Header */}
                      <div className="px-5 py-4 border-b border-[#1F1F22] bg-[#0E0E10] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-xs uppercase tracking-widest font-bold text-[#A1A1AA] flex items-center gap-1.5">
                              <FileText className="w-4 h-4 text-[#00E5FF]" />
                              <span>當前待統整工作列表</span>
                            </h3>
                            <span className="text-[10px] font-semibold bg-indigo-950/60 text-[#00E5FF] px-2.5 py-0.5 rounded-full border border-indigo-900/40">
                              {records.length} 筆
                            </span>
                            <span className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1.5 animate-pulse">
                              <Users className="w-3 h-3 text-emerald-400" />
                              <span>代碼: {currentSessionCode}</span>
                            </span>
                          </div>
                          <p className="text-[11px] text-[#71717A] mt-1.5">
                            目前開啟紀錄表：<strong className="text-slate-300 font-medium">{selectedSheet?.name}</strong>。此區資料修改將即時同步。
                          </p>
                        </div>

                        {records.length > 0 && (
                          <button
                            id="btn-clear-table"
                            onClick={handleClearRecords}
                            className="text-xs px-2.5 py-1 text-[#A1A1AA] hover:text-white bg-[#161618] hover:bg-[#1F1F22] rounded-md transition-colors flex items-center space-x-1 border border-[#2A2A2E] self-start sm:self-auto cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>清除全部</span>
                          </button>
                        )}
                      </div>

                      {/* Table / Working Area */}
                      <div className="grow overflow-x-auto">
                        {records.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                            <div className="w-14 h-14 bg-[#161618] border border-[#2A2A2E] rounded-2xl flex items-center justify-center text-[#71717A] mb-4 shadow-3xs">
                              <FileText className="w-6 h-6" />
                            </div>
                            <h4 className="text-sm font-semibold text-[#E0E0E0]">列表目前空無一物</h4>
                            <p className="text-xs text-[#71717A] mt-1 max-w-sm">
                              請在上傳相片進行「辨識」，或是直接點擊下方「手動新增紀錄」開始手動填表。
                            </p>
                            <div className="mt-5">
                              <button
                                id="btn-add-initial-manual"
                                onClick={handleAddManualRow}
                                className="text-xs px-3.5 py-1.5 bg-[#161618] text-[#00E5FF] border border-[#2A2A2E] hover:bg-[#1F1F22] font-semibold rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>手動新增紀錄</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <table className="w-full text-left border-collapse table-auto min-w-[640px]">
                            <thead>
                              <tr className="border-b border-[#1F1F22] text-[10px] uppercase tracking-wider font-bold text-[#71717A] bg-[#0E0E10]">
                                <th className="px-4 py-3">客戶名稱</th>
                                <th className="px-4 py-3">模具編號</th>
                                <th className="px-4 py-3">良品數量</th>
                                <th className="px-4 py-3">不良品數量</th>
                                <th className="px-4 py-3">工時(小時)</th>
                                <th className="px-4 py-3">工作者</th>
                                <th className="px-4 py-3 text-center w-12">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#1F1F22] text-xs">
                              <AnimatePresence initial={false}>
                                {records.map((rec) => (
                                  <motion.tr
                                    key={rec.id}
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, x: -15 }}
                                    transition={{ duration: 0.15 }}
                                    className="hover:bg-[#161618]/30 transition-all"
                                  >
                                    {/* 客戶名稱 */}
                                    <td className="px-3 py-2">
                                      <input
                                        type="text"
                                        value={rec.client}
                                        onChange={(e) => handleRecordChange(rec.id, "client", e.target.value)}
                                        placeholder="客戶名稱"
                                        className="w-full bg-[#161618] hover:bg-[#1F1F22] focus:bg-[#0A0A0B] border border-transparent focus:border-indigo-500 rounded-md px-2 py-1.5 focus:outline-hidden transition-all text-slate-200 font-medium"
                                      />
                                    </td>

                                    {/* 模具編號 */}
                                    <td className="px-3 py-2">
                                      <input
                                        type="text"
                                        value={rec.moldId}
                                        onChange={(e) => handleRecordChange(rec.id, "moldId", e.target.value)}
                                        placeholder="模具編號"
                                        className="w-full bg-[#161618] hover:bg-[#1F1F22] focus:bg-[#0A0A0B] border border-transparent focus:border-indigo-500 rounded-md px-2 py-1.5 focus:outline-hidden transition-all text-slate-200 font-mono"
                                      />
                                    </td>

                                    {/* 良品數量 */}
                                    <td className="px-3 py-2 w-24">
                                      <input
                                        type="number"
                                        value={rec.goodQty === 0 ? "" : rec.goodQty}
                                        onChange={(e) => handleNumberChange(rec.id, "goodQty", e.target.value)}
                                        placeholder="良品"
                                        min="0"
                                        className="w-full bg-[#161618] hover:bg-[#1F1F22] focus:bg-[#0A0A0B] border border-transparent focus:border-[#00E5FF] rounded-md px-2 py-1.5 focus:outline-hidden transition-all font-semibold text-[#00E5FF] font-mono"
                                      />
                                    </td>

                                    {/* 不良品數量 */}
                                    <td className="px-3 py-2 w-24">
                                      <input
                                        type="number"
                                        value={rec.badQty === 0 ? "" : rec.badQty}
                                        onChange={(e) => handleNumberChange(rec.id, "badQty", e.target.value)}
                                        placeholder="不良"
                                        min="0"
                                        className="w-full bg-[#161618] hover:bg-[#1F1F22] focus:bg-[#0A0A0B] border border-transparent focus:border-rose-500 rounded-md px-2 py-1.5 focus:outline-hidden transition-all font-semibold text-rose-400 font-mono"
                                      />
                                    </td>

                                    {/* 工時 */}
                                    <td className="px-3 py-2 w-24">
                                      <input
                                        type="number"
                                        step="0.1"
                                        value={rec.workHours === 0 ? "" : rec.workHours}
                                        onChange={(e) => handleNumberChange(rec.id, "workHours", e.target.value)}
                                        placeholder="小時"
                                        min="0"
                                        className="w-full bg-[#161618] hover:bg-[#1F1F22] focus:bg-[#0A0A0B] border border-transparent focus:border-indigo-500 rounded-md px-2 py-1.5 focus:outline-hidden transition-all font-mono text-slate-300"
                                      />
                                    </td>

                                    {/* 工作者 */}
                                    <td className="px-3 py-2 w-28">
                                      <input
                                        type="text"
                                        value={rec.operator}
                                        onChange={(e) => handleRecordChange(rec.id, "operator", e.target.value)}
                                        placeholder="工作者"
                                        className="w-full bg-[#161618] hover:bg-[#1F1F22] focus:bg-[#0A0A0B] border border-transparent focus:border-indigo-500 rounded-md px-2 py-1.5 focus:outline-hidden transition-all text-slate-200"
                                      />
                                    </td>

                                    {/* Action Delete */}
                                    <td className="px-2 py-2 text-center">
                                      <button
                                        id={`btn-delete-row-${rec.id}`}
                                        onClick={() => handleRemoveRow(rec.id)}
                                        className="p-1.5 text-[#71717A] hover:text-red-400 hover:bg-rose-950/20 rounded-md transition-colors cursor-pointer"
                                        title="刪除此列"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </motion.tr>
                                ))}
                              </AnimatePresence>
                            </tbody>
                          </table>
                        )}
                      </div>

                      {/* Table Footer Control Deck */}
                      {records.length > 0 && (
                        <div className="px-5 py-3 border-t border-[#1F1F22] bg-[#0E0E10] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs">
                          <button
                            id="btn-append-row"
                            onClick={handleAddManualRow}
                            className="inline-flex items-center space-x-1.5 text-[#00E5FF] hover:opacity-80 font-bold tracking-tight self-start sm:self-auto transition-colors cursor-pointer"
                          >
                            <PlusCircle className="w-4 h-4 text-[#00E5FF]" />
                            <span>新增手動紀錄行 (空白列)</span>
                          </button>

                          <div className="flex flex-wrap items-center gap-4 text-[#A1A1AA] font-semibold">
                            <span className="flex items-center space-x-1">
                              <ThumbsUp className="w-3.5 h-3.5 text-[#00E5FF] shrink-0" />
                              <span>良品: <strong className="text-white font-mono">{totalGood}</strong></span>
                            </span>
                            <span className="flex items-center space-x-1">
                              <ThumbsDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              <span>不良品: <strong className="text-white font-mono">{totalBad}</strong></span>
                            </span>
                            <span className="flex items-center space-x-1">
                              <TrendingUp className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                              <span>良率: <strong className="text-[#00E5FF] font-mono">{yieldRate}%</strong></span>
                            </span>
                            <span className="flex items-center space-x-1 border-l border-[#1F1F22] pl-4">
                              <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span>總工時: <strong className="text-white font-mono">{totalHours.toFixed(1)}h</strong></span>
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Submission Command Block inside Panel 3 */}
                      {records.length > 0 && (
                        <div className="p-4 bg-indigo-950/20 border-t border-[#1F1F22] flex flex-col sm:flex-row items-center justify-between gap-4">
                          <div className="flex items-start space-x-2.5">
                            <FileSpreadsheet className="w-5 h-5 text-[#00E5FF] shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-semibold text-white">
                                準備就緒：即將統整 {records.length} 筆資料
                              </p>
                              <p className="text-[10px] text-[#A1A1AA] mt-0.5 leading-relaxed">
                                {selectedSheet
                                  ? `目標試算表為「${selectedSheet.name}」，資料將追加至最下方。`
                                  : "未選擇目標試算表，請在上方建立或選取一筆。"}
                              </p>
                            </div>
                          </div>

                          <button
                            id="btn-sync-to-sheets"
                            onClick={handleSaveToSheet}
                            disabled={isSaving || !selectedSheet}
                            className="w-full sm:w-auto px-5 py-3 bg-[#00E5FF] text-black text-xs font-bold rounded-xl shadow-[0_0_20px_rgba(0,229,255,0.2)] hover:opacity-90 flex items-center justify-center space-x-2 transition-all disabled:opacity-50 shrink-0 cursor-pointer"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>正在同步寫入 Google 試算表...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Confirm & Sync to Google Sheets</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Elegant Modal: Create New Spreadsheet */}
      <AnimatePresence>
        {showCreateModal && (
          <div id="create-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0E0E10] rounded-2xl border border-[#1F1F22] shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-[#1F1F22]">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Plus className="w-4 h-4 text-[#00E5FF]" />
                  <span>建立新 Google 試算表</span>
                </h3>
                <p className="text-[11px] text-[#71717A] mt-1">
                  我們將在您的 Google 雲端硬碟中建立此檔案，並自動初始化包含客戶、模具、工時、良率在內的完整標準欄位。
                </p>
              </div>

              <form onSubmit={handleCreateSheet}>
                <div className="p-6 space-y-4">
                  <div>
                    <label htmlFor="new-sheet-title" className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                      試算表名稱
                    </label>
                    <input
                      id="new-sheet-title"
                      type="text"
                      required
                      value={newSheetTitle}
                      onChange={(e) => setNewSheetTitle(e.target.value)}
                      placeholder={`例如: 工廠生產工時紀錄表_${new Date().getFullYear()}`}
                      className="w-full bg-[#161618] border border-[#2A2A2E] text-[#E0E0E0] rounded-lg px-3 py-2.5 text-xs focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="px-6 py-4 bg-[#0D0D0F] flex items-center justify-end space-x-3 border-t border-[#1F1F22]">
                  <button
                    id="btn-close-create-modal"
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="text-xs text-[#A1A1AA] hover:text-white font-medium px-4 py-2 hover:bg-[#161618] rounded-lg transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    id="btn-submit-create-sheet"
                    type="submit"
                    disabled={isCreatingSheet}
                    className="text-xs px-4 py-2 bg-[#00E5FF] text-black font-bold rounded-lg shadow-2xs flex items-center space-x-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isCreatingSheet ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>正在建立中...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>確定建立</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Alert Dialog */}
      <AnimatePresence>
        {alertDialog && (
          <div id="alert-dialog-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0E0E10] rounded-2xl border border-[#1F1F22] shadow-xl max-w-sm w-full overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="p-1.5 bg-indigo-950/40 text-[#00E5FF] rounded-lg">
                    <Info className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-white">{alertDialog.title}</h3>
                </div>
                <p className="text-xs text-[#A1A1AA] leading-relaxed whitespace-pre-wrap">{alertDialog.message}</p>
              </div>
              <div className="px-6 py-4 bg-[#0D0D0F] flex items-center justify-end border-t border-[#1F1F22]">
                <button
                  id="btn-alert-confirm"
                  onClick={() => setAlertDialog(null)}
                  className="text-xs px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  確認
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Confirm Dialog */}
      <AnimatePresence>
        {confirmDialog && (
          <div id="confirm-dialog-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0E0E10] rounded-2xl border border-[#1F1F22] shadow-xl max-w-sm w-full overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="p-1.5 bg-amber-950/40 text-amber-400 rounded-lg">
                    <CircleAlert className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-white">{confirmDialog.title}</h3>
                </div>
                <p className="text-xs text-[#A1A1AA] leading-relaxed whitespace-pre-wrap">{confirmDialog.message}</p>
              </div>
              <div className="px-6 py-4 bg-[#0D0D0F] flex items-center justify-end space-x-3 border-t border-[#1F1F22]">
                <button
                  id="btn-confirm-cancel"
                  onClick={() => setConfirmDialog(null)}
                  className="text-xs text-[#A1A1AA] hover:text-white font-medium px-4 py-2 hover:bg-[#161618] rounded-lg transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  id="btn-confirm-ok"
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog(null);
                  }}
                  className="text-xs px-4 py-2 bg-[#00E5FF] text-black font-bold rounded-lg transition-colors cursor-pointer"
                >
                  確認
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Footer Credits */}
      <footer id="footer-credits" className="bg-[#0E0E10] py-8 border-t border-[#1F1F22] text-center mt-20">
        <p className="text-[11px] text-[#71717A]">
          ProductionSync &middot; 整合 Google Workspace 雲端工作技術 &middot; © 2026
        </p>
      </footer>
    </div>
  );
}
