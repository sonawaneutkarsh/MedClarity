import type { MedicalDocument } from './types';

/**
 * Two fictional records for a fictional patient, bundled so the app can be explored
 * without uploading anything. The text is shown as-is in the viewer; no PDF exists.
 * The pair deliberately contains discrepancies (allergy history, smoking status,
 * statin dose) for the conflict check to find.
 */
export const SAMPLE_DOCUMENTS: MedicalDocument[] = [
  {
    id: 'sample-doc-1',
    name: 'Apex_Cardiology_Summary_Doe_John.pdf',
    uploadDate: '2026-03-12',
    pageCount: 3,
    sizeString: '420 KB',
    pages: [
      {
        pageNumber: 1,
        text: `PATIENT DEMOGRAPHICS & CLINICAL METRICS
Name: John Doe | DOB: 1978-08-14 | Gender: Male
Encounter Date: March 12, 2026 | Provider: Dr. Sarah Vance, MD

REASON FOR ENCOUNTER:
Follow-up for primary cardiac profile evaluation, chronic hypertension, chest discomfort, and hyperlipidemia management.

VITAL SIGNS:
Height: 180 cm | Weight: 92 kg | BMI: 28.4 (Overweight)
Blood Pressure: 145/92 mmHg (Elevated) | Heart Rate: 72 bpm | SpO2: 98% on room air

ALLERGIC DISPOSITION & SOCIAL HISTORY:
- Drug Allergies: Severe allergy to Penicillin (Anaphylaxis in 2018).
- Smoking: Denies any lifetime tobacco or smoking history (never smoked).

ECG FINDINGS:
Sinus rhythm at 74 bpm. Prominent voltage criteria in lead V5 and V6 indicating early forms of Left Ventricular Hypertrophy (LVH). No ST-segment elevations or active T-wave inversions observed.`
      },
      {
        pageNumber: 2,
        text: `Apex Cardiology Clinic - Doe, John - Page 2

BASELINE lipid PROFILE LABS (Done March 10, 2026):
- Total Cholesterol: 240 mg/dL (Severely elevated)
- Triglycerides: 210 mg/dL (Elevated)
- LDL Cholesterol: 155 mg/dL (High risk target range)
- HDL Cholesterol: 42 mg/dL (Sub-optimal level)

RECOMMENDATIONS & PHARMACOLOGICAL MANAGEMENT:
The elevated arterial blood pressures, abnormal lipid panel, and hypertensive ventricular changes require dual agent therapy:
1. Initiate Atorvastatin 40 mg PO nightly (titrated up from 10 mg) to combat hyperlipidemia.
2. Initiate Amlodipine 5 mg PO daily for blood pressure control.
3. Patient directed to restrict dietary sodium intake (~1500 mg daily limit).`
      },
      {
        pageNumber: 3,
        text: `Apex Cardiology Clinic - Doe, John - Page 3

DIAGNOSTIC CRITERIA & CONCLUSION:
Primary assessments correspond to Essential Arterial Hypertension combined with Hyperlipidemia.
Follow up scheduled in 90 days (June 2026) to audit blood lipid profile panel and test kidney creatinine clearance.`
      }
    ],
    timelineEntries: [
      {
        date: '2026-03-12',
        isoDate: '2026-03-12',
        event: 'Diagnosed with early Left Ventricular Hypertrophy (LVH) via ECG findings',
        sourceDocId: 'sample-doc-1',
        sourceDocName: 'Apex_Cardiology_Summary_Doe_John.pdf',
        pageNumber: 1,
        type: 'clinical_finding',
        epochTime: Date.parse('2026-03-12')
      },
      {
        date: '2026-03-12',
        isoDate: '2026-03-12',
        event: 'Initiated Atorvastatin 40mg nightly and Amlodipine 5mg daily',
        sourceDocId: 'sample-doc-1',
        sourceDocName: 'Apex_Cardiology_Summary_Doe_John.pdf',
        pageNumber: 2,
        type: 'treatment',
        epochTime: Date.parse('2026-03-12')
      }
    ]
  },
  {
    id: 'sample-doc-2',
    name: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf',
    uploadDate: '2026-06-10',
    pageCount: 2,
    sizeString: '250 KB',
    pages: [
      {
        pageNumber: 1,
        text: `APEX CARDIOLOGY CLINICAL REASSESSMENT
Patient: John Doe | Diagnostic Re-evaluation Date: June 10, 2026
Attendant Phys: Dr. Sarah Vance, MD

FOLLOW-UP REVIEW:
Patient returns for 90-day progress panel. Reports high medication adherence. Denies any drug allergies (states "No Known Drug Allergies - NKDA").
Dr. Vance prescribed amoxicillin/clavulanate (Penicillin family resistance) today for mild bronchitis.
Patient reports smoking half a pack of cigarettes daily for the last 15 years, seeking tobacco cessation counseling.

VITAL PROGRESSION:
Blood Pressure: 128/80 mmHg (Normal control - indicating strong responsiveness to Amlodipine 5 mg daily).
Weight recorded at 89.5 kg (Loss of 2.5 kg).`
      },
      {
        pageNumber: 2,
        text: `Apex Cardiology Clinic - 90-Day Lipid Panel - Page 2

BLOOD LIPID PROFILE COMPARISON:
- Total Cholesterol: 165 mg/dL (Successful decline from March 2026 baseline of 240 mg/dL)
- Triglycerides: 135 mg/dL (Normal control, decline from March 2026 baseline of 210 mg/dL)
- LDL Cholesterol: 88 mg/dL (Outstanding result, successfully meeting the cardiological target of <100 mg/dL, decline from March 2026 baseline of 155 mg/dL on Atorvastatin)
- HDL Cholesterol: 50 mg/dL (Cardio-protective state, improvement from 42 mg/dL)

CLINICAL DECISION TRAIL & DISCREPANCY:
Patient notes he is taking his "Atorvastatin 10 mg daily" (Note: March recommendations were Atorvastatin 40 mg nightly).
Continue Amlodipine 5 mg PO daily. Continue Atorvastatin 40 mg PO nightly. Next baseline metabolic panels scheduled for December 2026.`
      }
    ],
    timelineEntries: [
      {
        date: '2026-06-10',
        isoDate: '2026-06-10',
        event: 'Blood Pressure successfully controlled to 128/80 mmHg using daily Amlodipine',
        sourceDocId: 'sample-doc-2',
        sourceDocName: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf',
        pageNumber: 1,
        type: 'clinical_finding',
        epochTime: Date.parse('2026-06-10')
      },
      {
        date: '2026-06-10',
        isoDate: '2026-06-10',
        event: 'Serum Blood Test confirms LDL Cholesterol reduced from high levels to 88 mg/dL',
        sourceDocId: 'sample-doc-2',
        sourceDocName: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf',
        pageNumber: 2,
        type: 'lab_result',
        epochTime: Date.parse('2026-06-10')
      }
    ]
  }
];

export const SAMPLE_QUESTIONS: string[] = [
  "Compare the patient's lipids and cholesterol over the 90-day treatment timeline.",
  "Has John Doe's Blood Pressure successfully responded to his clinical therapies over time?",
  "Detail John Doe's active prescriptions and general treatment directives.",
  "Are there any clinical contradictions or dosage irregularities identified across these assessments?"
];
