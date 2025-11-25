const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

//middleware
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Zap-Shift Server is Run successfully')
});

app.listen(port, () => {
    console.log(`Zap-Shift Server is running on, http://localhost:${port}`);
})