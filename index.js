import "dotenv/config"
import express from "express"
import cors from "cors"

const app = express();
app.use(cors);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = 3000;

app.get('/', (req, res) => {
    res.send('Hello world');
})

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
})