import { supabase } from '../lib/supabase';
import { Patient, Vitals, PredictionResponse } from '../types';

export async function syncPatients(patients: Patient[]) {
  try {
    const { error } = await supabase
      .from('patients')
      .upsert(
        patients.map(p => ({
          patient_id: p.Patient_ID,
          name: p.Name,
          unit: p.Unit,
          temperature: p.CurrentTemperature,
          weight: p.Weight,
          updated_at: new Date().toISOString()
        })),
        { onConflict: 'patient_id' }
      );
    if (error) throw error;
  } catch (err) {
    console.error('Error syncing patients to Supabase:', err);
  }
}

export async function saveVitals(patientId: string, vitals: Vitals) {
  try {
    const { error } = await supabase
      .from('vitals')
      .insert({
        patient_id: patientId,
        spo2: vitals.SpO2,
        pi: vitals.PI,
        heart_rate: vitals.Heart_Rate,
        systolic: vitals.BP.systolic,
        diastolic: vitals.BP.diastolic,
        temperature: vitals.Temperature,
        respiratory_rate: vitals.Respiratory_Rate,
        fio2: vitals.FiO2,
        weight: vitals.Weight,
        timestamp: vitals.Timestamp
      });
    if (error) throw error;
  } catch (err) {
    console.error('Error saving vitals to Supabase:', err);
  }
}

export async function savePrediction(prediction: PredictionResponse) {
  try {
    const { error } = await supabase
      .from('predictions')
      .insert({
        patient_id: prediction.Patient_ID,
        prediction: prediction.Prediction,
        confidence_score: prediction.Confidence_Score,
        reasoning: prediction.Reasoning,
        alert_status: prediction.Alert_Status,
        created_at: new Date().toISOString()
      });
    if (error) throw error;
  } catch (err) {
    console.error('Error saving prediction to Supabase:', err);
  }
}
