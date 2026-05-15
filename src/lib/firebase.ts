import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer, initializeFirestore } from 'firebase/firestore';
import rawConfig from '../../firebase-applet-config.json';

// In some Vite setups, JSON imports are nested in a 'default' property
const firebaseConfig = (rawConfig as any).default || rawConfig;

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'system', 'connection'));
  } catch (error) {
    console.error("Firestore test connection error:", error);
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or network proxy.");
    }
  }
}
testConnection();
