import { GoogleGenAI, Type } from "@google/genai";
import { PredictionResponse, Patient } from "../types";

const SYSTEM_INSTRUCTION = `You are "NICU," an AI prediction model integrated into a digital twin application for neonatal intensive care. Your role is to analyze real-time vital signs of admitted neonates and predict their risk of developing hypoxia within the next 1 to 2 hours.

Input Data: You will receive a JSON formatted stream containing the vitals for all monitored babies in the unit, including their current weight, temperature, respiratory rate, and FiO2 (if available).

Analysis Logic & Rules:
- Continuous Monitoring: Evaluate the trend of the vitals over the recent data points for each baby.
- Risk Assessment: Determine the likelihood of hypoxia occurring in the next 1-2 hours based on standard neonatal clinical thresholds.
- Weight Consideration: Take the baby's weight into account for baseline thresholds.
- **New Vitals Consideration**: 
    - Temperature: Fever or hypothermia can indicate infection or stress, increasing metabolic demand.
    - Respiratory Rate: Tachypnea or apnea are strong indicators of respiratory distress.
    - FiO2: High oxygen requirement (FiO2 > 21%) indicates existing respiratory support; increasing FiO2 needs are a major red flag.
- **Cross-Patient Correlation (CRITICAL)**: Analyze patterns across the entire unit. If multiple babies show similar declining trends or unusual vital shifts simultaneously, consider environmental factors (e.g., equipment failure, oxygen supply issues, or localized infection outbreaks). The vitals of one baby should inform your assessment of others.

Standard SpO2 for neonates is usually 90-95%. Below 85% is critical. PI below 0.4% is low. Heart rate for neonates is 120-160 BPM. Respiratory rate is 40-60 breaths/min.

Output Structure:
For each patient analyzed, provide:
- Patient_ID: [The ID]
- Prediction: ["Low Risk", "Moderate Risk", "High Risk/Imminent Hypoxia"]
- Confidence_Score: [0-100]
- Reasoning: [Brief explanation including how weight, individual vitals (including Temp, RR, FiO2), AND unit-wide correlations influenced the result]
- Alert_Status: ["None", "Monitor", "CRITICAL - NOTIFY STAFF"]

Alert Trigger: If the Prediction is "High Risk/Imminent Hypoxia", you MUST set Alert_Status to "CRITICAL - NOTIFY STAFF".`;

export async function getHypoxiaPredictions(patients: Patient[]): Promise<PredictionResponse[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Prepare the data for the prompt
  const inputData = patients.map(p => ({
    Patient_ID: p.Patient_ID,
    Weight: p.Weight,
    Recent_Vitals: p.vitals.slice(-5) // Last 5 readings
  }));

  const maxRetries = 5;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: JSON.stringify(inputData),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                Patient_ID: { type: Type.STRING },
                Prediction: { type: Type.STRING },
                Confidence_Score: { type: Type.NUMBER },
                Reasoning: { type: Type.STRING },
                Alert_Status: { type: Type.STRING }
              },
              required: ["Patient_ID", "Prediction", "Confidence_Score", "Reasoning", "Alert_Status"]
            }
          }
        }
      });

      return JSON.parse(response.text || "[]");
    } catch (error: any) {
      const isRateLimit = error?.message?.includes("429") || error?.status === 429 || JSON.stringify(error).includes("429");
      
      if (isRateLimit && retryCount < maxRetries) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 2000 + Math.random() * 1000; // Increased base delay
        console.warn(`Gemini Rate Limit (429). Retrying in ${Math.round(delay)}ms... (Attempt ${retryCount}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error("Error calling Gemini:", error);
      return [];
    }
  }
  return [];
}
