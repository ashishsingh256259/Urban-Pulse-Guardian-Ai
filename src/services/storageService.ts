import { ref, uploadBytes, uploadString, getDownloadURL } from "firebase/storage";
import { storage } from "../lib/firebase";

/**
 * Supported MIME types for evidence uploads
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Megabytes

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  sizeFormatted?: string;
}

/**
 * Validates an upload file before sending to Firebase Storage.
 */
export function validateEvidenceFile(file: File): FileValidationResult {
  if (!file) {
    return { valid: false, error: "No file was selected for upload." };
  }

  // Type check
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type.toLowerCase()) && !file.type.startsWith("image/")) {
    return {
      valid: false,
      error: `Invalid format: ${file.type || "unknown"}. Only image files (JPEG, PNG, WebP) are accepted as hazard evidence.`
    };
  }

  // Size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds the 10MB limit (${sizeMb} MB). Please capture or select a compressed image.`
    };
  }

  if (file.size === 0) {
    return { valid: false, error: "The selected file contains 0 bytes." };
  }

  const sizeFormatted = file.size > 1024 * 1024
    ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
    : `${(file.size / 1024).toFixed(0)} KB`;

  return { valid: true, sizeFormatted };
}

/**
 * Storage Path Conventions:
 * - reports/{userId}/{reportId}/evidence/{filename}
 * - road-scanner/{userId}/{scanId}/evidence/{clusterId}_{frameIndex}.jpg
 */

/**
 * Helper to wrap any promise in a hard timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Uploads citizen manual report evidence to Firebase Storage.
 */
export async function uploadReportEvidence(
  userId: string,
  reportId: string,
  imageData: File | Blob | string,
  filename: string = "primary.jpg"
): Promise<string> {
  const cleanUserId = (userId || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanReportId = reportId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, "_");

  // Prevent duplicate uploads if imageData is already a remote HTTP/HTTPS URL
  if (typeof imageData === "string" && (imageData.startsWith("http://") || imageData.startsWith("https://"))) {
    return imageData;
  }

  const path = `reports/${cleanUserId}/${cleanReportId}/evidence/${cleanFilename}`;
  const storageRef = ref(storage, path);

  try {
    const uploadTask = async () => {
      if (typeof imageData === "string") {
        if (imageData.startsWith("data:")) {
          await uploadString(storageRef, imageData, "data_url");
        } else {
          await uploadString(storageRef, imageData, "raw");
        }
      } else {
        const contentType = imageData instanceof File && imageData.type ? imageData.type : "image/jpeg";
        await uploadBytes(storageRef, imageData, { contentType });
      }
      return await getDownloadURL(storageRef);
    };

    return await withTimeout(uploadTask(), 15000, "Firebase Storage evidence upload timed out. Please check your network and retry.");
  } catch (error: any) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error(`[StorageService] Evidence upload failed for path ${path}:`, errMessage);
    throw new Error(`Firebase Storage upload failed: ${errMessage}`);
  }
}

/**
 * Legacy compatibility alias
 */
export const uploadReportImage = uploadReportEvidence;

/**
 * Uploads Field Team verification and resolution evidence to Firebase Storage.
 * Path: incidents/{cleanIncidentId}/field-evidence/{cleanTeamId}/{filename}
 */
export async function uploadFieldEvidence(
  incidentId: string,
  teamId: string,
  imageData: File | Blob | string,
  type: "before" | "after" | "verification" | "general" = "general",
  customFilename?: string
): Promise<string> {
  const cleanIncidentId = (incidentId || "inc_temp").replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanTeamId = (teamId || "field_team").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = customFilename || `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.jpg`;
  const cleanFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, "_");

  // If already an HTTP/HTTPS URL, return as-is
  if (typeof imageData === "string" && (imageData.startsWith("http://") || imageData.startsWith("https://"))) {
    return imageData;
  }

  const path = `incidents/${cleanIncidentId}/field-evidence/${cleanTeamId}/${cleanFilename}`;
  const storageRef = ref(storage, path);

  try {
    const uploadTask = async () => {
      if (typeof imageData === "string") {
        if (imageData.startsWith("data:")) {
          await uploadString(storageRef, imageData, "data_url");
        } else {
          await uploadString(storageRef, imageData, "raw");
        }
      } else {
        const contentType = imageData instanceof File ? imageData.type : "image/jpeg";
        await uploadBytes(storageRef, imageData, { contentType });
      }
      return await getDownloadURL(storageRef);
    };

    return await withTimeout(uploadTask(), 10000, "Field evidence upload timed out.");
  } catch (error) {
    console.warn("Firebase Storage field evidence upload failed (falling back to direct reference):", error);
    if (typeof imageData === "string") {
      return imageData;
    }
    return URL.createObjectURL(imageData);
  }
}

/**
 * Convenient helper to upload an evidence image for a user
 */
export async function uploadEvidenceImage(
  fileOrData: File | Blob | string,
  userId: string,
  reportId?: string
): Promise<{ success: boolean; downloadUrl?: string; error?: string; isFallback?: boolean }> {
  try {
    if (!userId || userId === "anonymous") {
      return {
        success: false,
        isFallback: false,
        error: "Authentication required: Cannot upload evidence without an authenticated Firebase user session."
      };
    }

    // If already an authenticated remote URL, return immediately without re-uploading
    if (
      typeof fileOrData === "string" &&
      (fileOrData.startsWith("https://") || fileOrData.startsWith("http://")) &&
      !fileOrData.startsWith("blob:") &&
      !fileOrData.startsWith("data:")
    ) {
      return { success: true, downloadUrl: fileOrData, isFallback: false };
    }

    const targetReportId = reportId || `REP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const filename = fileOrData instanceof File ? fileOrData.name : `evidence_${Date.now()}.jpg`;
    const downloadUrl = await uploadReportEvidence(userId, targetReportId, fileOrData, filename);
    
    const isRemoteUrl = typeof downloadUrl === "string" && 
      (downloadUrl.startsWith("https://firebasestorage.googleapis.com") ||
       downloadUrl.startsWith("https://storage.googleapis.com") ||
       (downloadUrl.startsWith("https://") && !downloadUrl.startsWith("blob:") && !downloadUrl.startsWith("data:")));

    if (isRemoteUrl) {
      return { success: true, downloadUrl, isFallback: false };
    } else {
      return { 
        success: false, 
        isFallback: false, 
        error: "Firebase Storage returned an invalid evidence download URL." 
      };
    }
  } catch (err: any) {
    const errorMsg = err?.message || "Storage upload failed. Please verify your network and permissions.";
    console.error("[StorageService] Evidence upload error:", errorMsg);
    return { success: false, isFallback: false, error: errorMsg };
  }
}

/**
 * Uploads AI Road Scanner dashcam evidence frames to Firebase Storage.
 */
export async function uploadRoadScanEvidenceFrame(
  userId: string,
  scanId: string,
  clusterId: string,
  frameIndex: number,
  base64DataUrl: string
): Promise<string> {
  const cleanUserId = (userId || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanScanId = scanId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanClusterId = clusterId.replace(/[^a-zA-Z0-9_-]/g, "_");

  const path = `road-scanner/${cleanUserId}/${cleanScanId}/evidence/${cleanClusterId}_${frameIndex}.jpg`;
  const storageRef = ref(storage, path);

  try {
    await uploadString(storageRef, base64DataUrl, "data_url");
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.warn("Road scan storage upload error:", error);
    throw new Error(`Road scan storage upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
