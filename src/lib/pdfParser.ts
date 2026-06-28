import { MedicalDocument, DocumentPage } from '../types';
import { callGemini } from './gemini';

/**
 * Client-side PDF Text and Page Extractor using PDF.js loaded via CDN.
 */
export async function parsePdfFile(file: File): Promise<Omit<MedicalDocument, 'id'>> {
  const pdfjs = (window as any).pdfjsLib;
  if (!pdfjs) {
    throw new Error("PDF.js library was not loaded properly. Please check your network connection.");
  }

  // Set the worker source safely
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const pageCount = pdf.numPages;
    const pages: DocumentPage[] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      
      pages.push({
        pageNumber: i,
        text: pageText.trim()
      });
    }

    // Initialize document date string from file system or today's date
    const dateObj = new Date(file.lastModified || Date.now());
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const uploadDate = `${year}-${month}-${day}`;

    // Size formatting
    const sizeInKb = file.size / 1024;
    const sizeString = sizeInKb > 1000 
      ? `${(sizeInKb / 1024).toFixed(1)} MB` 
      : `${sizeInKb.toFixed(0)} KB`;

    return {
      name: file.name,
      uploadDate,
      pageCount,
      pages,
      sizeString,
      rawFile: file
    };
  } catch (error: any) {
    console.error("PDF Parsing error:", error);
    throw new Error(error?.message || "Failed to parse PDF document. It may be corrupt or encrypted.");
  }
}

/**
 * Uses Gemini to extract the precise clinical report date from raw document pages
 */
export async function extractClinicalReportDate(
  apiKey: string,
  docName: string,
  firstPageText: string,
  fallbackDate: string
): Promise<string> {
  if (!apiKey) return fallbackDate;
  
  const systemInstruction = "You are a clinical registrar. Extract the single primary date of clinical relevance (e.g., date of exam, lab draw date, admission date, or report print date) from the patient record header.";
  const prompt = `
Document Name: "${docName}"
First Page Content:
"""
${firstPageText.substring(0, 3000)}
"""

Look for terms like "Date of Study", "Collected on:", "Test Date:", "Date:", or "Report Date:" in the text above.
Determine the single overall date this report represents.
Return ONLY that date formatted as YYYY-MM-DD. 
If no specific date of clinical significance is found, return exactly this fallback date: "${fallbackDate}".
Do not include any other conversational text or explanation. Return ONLY the YYYY-MM-DD string.
`;

  try {
    const extractedText = await callGemini(apiKey, systemInstruction, prompt, false);
    const trimmedText = (extractedText || "").trim();
    
    // Check if it fits YYYY-MM-DD format roughly
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateRegex.test(trimmedText)) {
      return trimmedText;
    }
    return fallbackDate;
  } catch {
    return fallbackDate;
  }
}
