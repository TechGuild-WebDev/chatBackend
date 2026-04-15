import admin from 'firebase-admin';
import serviceAccount from '../config/firebase-config.json'; // Path to your Firebase credentials file

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

export default admin;


