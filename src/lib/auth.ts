import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Decrypt helper for security
function decryptSecret(str: string): string {
  if (!str) return "";
  if (str.startsWith("enc:")) {
    try {
      const raw = str.slice(4);
      const decoded = atob(raw);
      return Array.from(decoded)
        .map((c) => String.fromCharCode(c.charCodeAt(0) ^ 0x42))
        .join("");
    } catch (e) {
      console.error("[Auth] Failed to decrypt secret:", e);
      return str;
    }
  }
  return str;
}

const decryptedConfig = {
  projectId: decryptSecret(firebaseConfig.projectId),
  appId: decryptSecret(firebaseConfig.appId),
  apiKey: decryptSecret(firebaseConfig.apiKey),
  authDomain: decryptSecret(firebaseConfig.authDomain),
  firestoreDatabaseId: decryptSecret(firebaseConfig.firestoreDatabaseId),
  storageBucket: decryptSecret(firebaseConfig.storageBucket),
  messagingSenderId: decryptSecret(firebaseConfig.messagingSenderId),
  measurementId: decryptSecret(firebaseConfig.measurementId),
};

// Initialize Firebase App
const app = initializeApp(decryptedConfig);
export const auth = getAuth(app);

// Use initializeFirestore to allow passing settings such as experimentalForceLongPolling
import { initializeFirestore } from "firebase/firestore";
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, decryptedConfig.firestoreDatabaseId);

// Configure Google Auth Provider with requested Workspace scopes
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/spreadsheets");
provider.addScope("https://www.googleapis.com/auth/drive.file");
provider.setCustomParameters({
  prompt: 'select_account consent'
});

// Track whether a sign-in flow is actively running
let isSigningIn = false;

// Store Google OAuth access token in-memory only (security guideline)
let cachedAccessToken: string | null = null;

/**
 * Initializes the authentication listener.
 * This should be called on application mount.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // Token isn't cached (e.g. on page refresh), clear user to force sign-in
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Trigger Google Sign-In via Popup. Must be invoked by user interaction.
 */
export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to retrieve Google OAuth access token from Firebase Auth.");
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Firebase Sign-In Error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Get the current cached access token.
 */
export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

/**
 * Logs the user out of Firebase and clears the in-memory token.
 */
export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
