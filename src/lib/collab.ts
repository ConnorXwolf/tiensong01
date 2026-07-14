import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDocFromServer
} from "firebase/firestore";
import { User } from "firebase/auth";
import { db, auth } from "./auth";
import { ProductionRecord } from "./sheets";

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

/**
 * Handles errors conforming to the system requirements of firebase-integration skill.
 */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Validates connection to Firestore.
 */
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

/**
 * Generate a clean 6-digit uppercase sharing code
 */
function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a new collaborative editing session with the current working records
 */
export async function createSession(
  user: User,
  records: ProductionRecord[],
  sheetMetadata?: { sheetId: string; sheetName: string }
): Promise<string> {
  const code = generateCode();
  const path = `sessions/${code}`;
  
  try {
    // 1. Create the session metadata document
    const setSessionPromise = setDoc(doc(db, "sessions", code), {
      code,
      name: sheetMetadata?.sheetName || "生產工時共同編輯",
      creatorId: user.uid,
      creatorEmail: user.email || "",
      sheetId: sheetMetadata?.sheetId || "",
      sheetName: sheetMetadata?.sheetName || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    await Promise.race([
      setSessionPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore 連線逾時，請確認資料庫是否已啟用。")), 15000))
    ]);

    // 2. Upload initial record rows
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const recPath = `sessions/${code}/records/${rec.id}`;
      await setDoc(doc(db, "sessions", code, "records", rec.id), {
        client: rec.client,
        moldId: rec.moldId,
        goodQty: rec.goodQty,
        badQty: rec.badQty,
        workHours: rec.workHours,
        operator: rec.operator,
        order: i,
        updatedAt: serverTimestamp(),
      });
    }

    return code;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    return "";
  }
}

/**
 * Verifies if a session exists and returns its basic details
 */
export async function getSession(code: string) {
  const path = `sessions/${code}`;
  try {
    const getDocPromise = getDoc(doc(db, "sessions", code));
    const docSnap: any = await Promise.race([
      getDocPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore 連線逾時，請確認資料庫是否已啟用。")), 15000))
    ]);
    if (docSnap.exists()) {
      return docSnap.data();
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

/**
 * Update the Google sheet target linked to this session
 */
export async function updateSessionSheet(code: string, sheetId: string, sheetName: string) {
  const path = `sessions/${code}`;
  try {
    await updateDoc(doc(db, "sessions", code), {
      sheetId,
      sheetName,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Subscribes to changes on the session itself
 */
export function subscribeToSession(
  code: string,
  onUpdate: (session: any) => void,
  onError: (err: any) => void
) {
  const path = `sessions/${code}`;
  return onSnapshot(
    doc(db, "sessions", code),
    (docSnap) => {
      if (docSnap.exists()) {
        onUpdate(docSnap.data());
      } else {
        onError(new Error("此共同編輯文件已被刪除"));
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
      onError(error);
    }
  );
}

/**
 * Subscribes to changes on the records subcollection
 */
export function subscribeToRecords(
  code: string,
  onUpdate: (records: ProductionRecord[]) => void,
  onError: (err: any) => void
) {
  const path = `sessions/${code}/records`;
  const q = query(collection(db, "sessions", code, "records"), orderBy("order", "asc"));
  
  return onSnapshot(
    q,
    (snapshot) => {
      const records: ProductionRecord[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        records.push({
          id: doc.id,
          client: data.client || "",
          moldId: data.moldId || "",
          goodQty: data.goodQty || 0,
          badQty: data.badQty || 0,
          workHours: data.workHours || 0,
          operator: data.operator || "",
        });
      });
      onUpdate(records);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
      onError(error);
    }
  );
}

/**
 * Saves/updates a single record row in Firestore
 */
export async function saveRecordRow(code: string, rec: ProductionRecord, order: number) {
  const path = `sessions/${code}/records/${rec.id}`;
  try {
    await setDoc(doc(db, "sessions", code, "records", rec.id), {
      client: rec.client,
      moldId: rec.moldId,
      goodQty: rec.goodQty,
      badQty: rec.badQty,
      workHours: rec.workHours,
      operator: rec.operator,
      order,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Deletes a single record row from Firestore
 */
export async function deleteRecordRow(code: string, recordId: string) {
  const path = `sessions/${code}/records/${recordId}`;
  try {
    await deleteDoc(doc(db, "sessions", code, "records", recordId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Clears all records from a session
 */
export async function clearAllRecordsInSession(code: string, recordIds: string[]) {
  const path = `sessions/${code}/records`;
  try {
    // Delete each one
    for (const id of recordIds) {
      await deleteDoc(doc(db, "sessions", code, "records", id));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Update the active sharing image linked to this session
 */
export async function updateSessionImage(
  code: string,
  activeImage: string | null,
  activeImageName: string | null
) {
  const path = `sessions/${code}`;
  try {
    await updateDoc(doc(db, "sessions", code), {
      activeImage,
      activeImageName,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
