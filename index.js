import "dotenv/config"
import express from "express"
import cors from "cors"

import { testFirestoreConnection } from "./firebaseConfig.js";
import apiRoutes from "./routes/index.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = 3000;

app.get('/', (req, res) => {
    res.send('Hello world');
})

app.use("/api/v1", apiRoutes);

app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
});

app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({
        message: error?.message || "Internal Server Error",
    });
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
    testFirestoreConnection();
})