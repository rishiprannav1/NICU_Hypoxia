export type RiskLevel = "Low Risk" | "Moderate Risk" | "High Risk/Imminent Hypoxia";
export type AlertStatus = "None" | "Monitor" | "CRITICAL - NOTIFY STAFF";

export interface Vitals {
  SpO2: number;
  PI: number;
  BP: {
    systolic: number;
    diastolic: number;
  };
  Heart_Rate: number;
  Temperature?: number;
  Respiratory_Rate?: number;
  FiO2?: number;
  Weight?: number; // Weight in grams
  Timestamp: string;
}

export interface Patient {
  Patient_ID: string;
  Name?: string; // Display name
  Unit?: string; // NICU Unit
  CurrentTemperature?: number; // Baseline temperature
  Weight?: number; // Current weight in grams
  vitals: Vitals[];
  isSimulating?: boolean;
  dismissCount?: number;
  isSilenced?: boolean;
}

export interface PredictionResponse {
  Patient_ID: string;
  Prediction: RiskLevel;
  Confidence_Score: number;
  Reasoning: string;
  Alert_Status: AlertStatus;
}
