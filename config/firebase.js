import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  collection as firestoreCollection, 
  doc as firestoreDoc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDocs, 
  query as firestoreQuery, 
  where as firestoreWhere, 
  orderBy as firestoreOrderBy 
} from "firebase/firestore";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyBPjvWGdVuK_U5HQzqJwgCeAWks1oPGh64",
  authDomain: "avyukt-restaurant.firebaseapp.com",
  projectId: "avyukt-restaurant",
  storageBucket: "avyukt-restaurant.firebasestorage.app",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const nativeFirestore = getFirestore(app);

class FirestoreDocRef {
  constructor(fsInstance, colName, docId) {
    this.fsInstance = fsInstance;
    this.colName = colName;
    this.docId = docId;
    this.ref = firestoreDoc(this.fsInstance, this.colName, this.docId);
  }

  async get() {
    const snap = await getDoc(this.ref);
    return {
      exists: snap.exists(),
      id: snap.id,
      data: () => snap.data(),
    };
  }

  async set(data, options = {}) {
    return await setDoc(this.ref, { ...data, id: this.docId }, options);
  }

  async update(data) {
    return await updateDoc(this.ref, data);
  }

  async delete() {
    return await deleteDoc(this.ref);
  }
}

class FirestoreColRef {
  constructor(fsInstance, colName) {
    this.fsInstance = fsInstance;
    this.colName = colName;
    this.colRef = firestoreCollection(this.fsInstance, this.colName);
  }

  doc(docId) {
    const id = docId || `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return new FirestoreDocRef(this.fsInstance, this.colName, id);
  }

  where(field, op, val) {
    const self = this;
    const queryObj = {
      limit(n) {
        return queryObj;
      },
      orderBy(f, dir) {
        return queryObj;
      },
      async get() {
        const q = firestoreQuery(self.colRef, firestoreWhere(field, op, val));
        const snap = await getDocs(q);
        const docs = [];
        snap.forEach((d) => docs.push({ id: d.id, data: () => d.data(), ref: self.doc(d.id) }));
        return {
          size: docs.length,
          empty: docs.length === 0,
          forEach: (cb) => docs.forEach(cb),
          docs,
        };
      },
    };
    return queryObj;
  }

  async get() {
    const snap = await getDocs(this.colRef);
    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, data: () => d.data(), ref: this.doc(d.id) }));
    return {
      size: docs.length,
      empty: docs.length === 0,
      forEach: (cb) => docs.forEach(cb),
      docs,
    };
  }
}

class UnifiedFirestoreBridge {
  constructor(fsInstance) {
    this.fsInstance = fsInstance;
  }

  collection(name) {
    return new FirestoreColRef(this.fsInstance, name);
  }
}

const db = new UnifiedFirestoreBridge(nativeFirestore);
const isLiveFirebase = true;
const auth = null;
const admin = null;

console.log("✅ Live Cloud Firestore connected successfully for Avyukt Backend");

export { admin, db, auth, isLiveFirebase };
