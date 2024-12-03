const express = require('express');
const multer = require('multer');
const cors = require("cors");
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');
const vision = require('@google-cloud/vision');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


// Decode and write the credentials file
const credentials = Buffer.from(process.env.GOOGLE_CREDENTIALS_JSON, 'base64').toString('utf-8');
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

fs.writeFileSync(credentialsPath, credentials);

// Import Gemini API client
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json()); // To parse JSON request bodies

// Google Cloud Configuration
const firestore = new Firestore();
const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME; // Set your bucket name in .env file
const visionClient = new vision.ImageAnnotatorClient();

// Initialize Gemini API client
const genAIKey = process.env.genAIKey
const genAI = new GoogleGenerativeAI(genAIKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Firestore collection reference
const collectionRef = firestore.collection('images');

// Function to generate story using Gemini API
const generateStory = async (mood) => {
    try {
        const prompt = `Write a random story about a person who is feeling ${mood.toLowerCase()}.`;

        // Generate story using Gemini
        const result = await model.generateContent(prompt);
        const story = result.response.text();

        // console.log('Gemini Response:', story); // Log the generated story

        return story;
    } catch (error) {
        console.error('Error generating story with Gemini:', error);
        return 'Failed to generate story.';
    }
};

// Function to decode base64 and save the image as a file
function saveBase64Image(base64Data, filePath) {
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
}

// Route for uploading and analyzing the image (original)
app.post('/api/upload', multer().single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send({ error: 'No file uploaded.' });
    }

    try {
        const fileName = `${Date.now()}-${req.file.originalname}`;
        const blob = storage.bucket(bucketName).file(fileName);

        // Upload image to Google Cloud Storage
        const blobStream = blob.createWriteStream();
        blobStream.end(req.file.buffer);

        // Wait for the upload to finish
        await new Promise((resolve, reject) => {
            blobStream.on('finish', resolve);
            blobStream.on('error', reject);
        });

        await blob.makePublic();
        // Get the public URL of the uploaded image
        const imageUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;
        console.log(imageUrl)
        // Analyze image using Google Vision API
        const [result] = await visionClient.faceDetection(imageUrl);
        console.log(result);

        // const labels = result.labelAnnotations.map(label => label.description);
        // console.log(labels);
        const faces = result.faceAnnotations;
        // Detect mood from labels (basic example)
        // let mood = "neutral";
        // if (faces.joyLikelihood == "VERY_LIKELY") {
        //     mood = "happy";
        // } else if (faces.sorrowLikelihood == "VERY_LIKELY") {
        //     mood = "sorrow";
        // } else if (faces.angerLikelihood == "VERY_LIKELY") {
        //     mood = "anger";
        // } else {
        //     mood = "neutral";
        // }

        let mood = "neutral";

        // Check each likelihood and set mood accordingly
        if (faces && faces.length > 0) {
            const face = faces[0]; // Assuming you're analyzing the first face in the result

            if (face.joyLikelihood === "VERY_LIKELY") {
                mood = "happy";
            } else if (face.sorrowLikelihood === "VERY_LIKELY") {
                mood = "sorrow";
            } else if (face.angerLikelihood === "VERY_LIKELY") {
                mood = "anger";
            } else if (face.surpriseLikelihood === "VERY_LIKELY") {
                mood = "surprised";
            } else if (face.joyLikelihood === "LIKELY") {
                mood = "happy";
            } else if (face.sorrowLikelihood === "LIKELY") {
                mood = "sorrow";
            } else if (face.angerLikelihood === "LIKELY") {
                mood = "anger";
            } else if (face.surpriseLikelihood === "LIKELY") {
                mood = "surprised";
            } else {
                mood = "neutral"; // Default mood if none are VERY_LIKELY
            }
        } else {
            console.log("No faces detected.");
        }

        console.log("Detected Mood:", mood);


        // Generate a random story using Gemini based on the mood
        const story = await generateStory(mood);

        // Save metadata, mood, and story to Firestore
        await collectionRef.add({
            fileName,
            imageUrl,
            mood,
            story,
            uploadedAt: Firestore.Timestamp.now(),
        });

        // Respond with the mood and generated story
        res.status(200).send({ success: true, title: `Mood: ${mood}`, story });
    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).send({ error: 'Failed to analyze the image and generate story.' });
    }
});

// New route for uploading base64 image and analyzing it
app.post('/api/upload2', async (req, res) => {
    const { base64Image } = req.body;
    console.log(base64Image);

    if (!base64Image) {
        return res.status(400).send({ error: 'Either base64Image or pinterestProfileUrl is required.' });
    }

    try {
        let imagePath;

        // If base64Image is provided, save it as a file
        if (base64Image) {
            // Generate a unique file name
            const fileName = `${Date.now()}-image.jpg`;
            imagePath = path.join(__dirname, 'uploads', fileName);  // Save to 'uploads' folder

            // Decode base64 and save the image
            saveBase64Image(base64Image.split(',')[1], imagePath);
        }

        // If Pinterest profile URL is provided, fetch the image URL
        // if (pinterestProfileUrl) {
        //     imagePath = await fetchPinterestProfileImage(pinterestProfileUrl);
        // }

        if (!imagePath) {
            return res.status(400).send({ error: 'Unable to fetch image from Pinterest profile.' });
        }

        console.log(`Using image: ${imagePath}`);

        // Analyze image using Google Vision API
        const [result] = await visionClient.faceDetection(imagePath);
        console.log(result);

        // const labels = result.labelAnnotations.map(label => label.description);
        // console.log(labels);
        const faces = result.faceAnnotations;
        // Detect mood from labels (basic example)
        // let mood = "neutral";
        // if (faces.joyLikelihood == "VERY_LIKELY") {
        //     mood = "happy";
        // } else if (faces.sorrowLikelihood == "VERY_LIKELY") {
        //     mood = "sorrow";
        // } else if (faces.angerLikelihood == "VERY_LIKELY") {
        //     mood = "anger";
        // } else {
        //     mood = "neutral";
        // }

        let mood = "neutral";

        // Check each likelihood and set mood accordingly
        if (faces && faces.length > 0) {
            const face = faces[0]; // Assuming you're analyzing the first face in the result

            if (face.joyLikelihood === "VERY_LIKELY") {
                mood = "happy";
            } else if (face.sorrowLikelihood === "VERY_LIKELY") {
                mood = "sorrow";
            } else if (face.angerLikelihood === "VERY_LIKELY") {
                mood = "anger";
            } else if (face.surpriseLikelihood === "VERY_LIKELY") {
                mood = "surprised";
            } else if (face.joyLikelihood === "LIKELY") {
                mood = "happy";
            } else if (face.sorrowLikelihood === "LIKELY") {
                mood = "sorrow";
            } else if (face.angerLikelihood === "LIKELY") {
                mood = "anger";
            } else if (face.surpriseLikelihood === "LIKELY") {
                mood = "surprised";
            } else {
                mood = "neutral"; // Default mood if none are VERY_LIKELY
            }
        } else {
            console.log("No faces detected.");
        }

        console.log("Detected Mood:", mood);

        // Generate a random story using Gemini based on the mood
        const story = await generateStory(mood);

        // Save metadata, mood, and story to Firestore
        await collectionRef.add({
            imageUrl: imagePath,
            mood,
            story,
            uploadedAt: Firestore.Timestamp.now(),
        });

        // Respond with the mood and generated story
        res.status(200).send({ success: true, title: `Mood: ${mood}`, story });
    } catch (error) {
        console.error('Error processing image or Pinterest profile:', error);
        res.status(500).send({ error: 'Failed to analyze the image and generate story.' });
    }
});

// Helper function to fetch image from Pinterest (simplified)
// const fetchPinterestProfileImage = async (pinterestProfileUrl) => {
//     try {
//         // Example of fetching profile image logic (to be updated based on actual needs)
//         const response = await axios.get(pinterestProfileUrl);
//         const $ = require('cheerio').load(response.data);  // Assuming you're using cheerio for HTML parsing
//         const profileImage = $('img').first().attr('src'); // Example of getting the first image

//         return profileImage;
//     } catch (error) {
//         console.error('Error fetching Pinterest profile image:', error);
//         return null;
//     }
// };

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

app.get("/", (req, res) => {
    res.send("Server running")
})

// setInterval(() => {
//     axios.get('https://cloudbackend-v8lr.onrender.com/')
//         .then(response => {
//             console.log('Pinged backend to keep it alive.');
//         })
//         .catch(error => {
//             console.error('Error pinging backend:', error);
//         });
// }, 2 * 60 * 1000);