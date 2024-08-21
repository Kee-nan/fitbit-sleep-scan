// Import Requirements
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Variables to load in Authentication details for Fitbit
const clientId = process.env.CLIENT_ID;
const redirectUri = process.env.REDIRECT_URI;
let codeVerifier = '';
let accessToken = '';
let refreshToken = '';

// Generate a code verifier and code challenge for authentication
function generateCodeChallenge() {
    codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return codeChallenge;
}

// Endpoint to Redirect to Fitbit's authorization page 
app.get('/auth', (req, res) => {
    const codeChallenge = generateCodeChallenge();
    const authUrl = `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=sleep&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    res.redirect(authUrl);
});

// Step 3: Handle the callback from Fitbit and exchange the authorization code for an access token
app.get('/callback', async (req, res) => {
    const authCode = req.query.code;

    try {
        const tokenResponse = await axios.post('https://api.fitbit.com/oauth2/token', null, {
            params: {
                client_id: clientId,
                grant_type: 'authorization_code',
                code: authCode,
                code_verifier: codeVerifier,
                redirect_uri: redirectUri
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${clientId}:${process.env.CLIENT_SECRET}`).toString('base64')}`
            }
        });

        accessToken = tokenResponse.data.access_token;
        refreshToken = tokenResponse.data.refresh_token;

        res.send('Authorization successful! You can now retrieve sleep data.');
    } catch (error) {
        console.error('Error retrieving access token:', error);
        res.status(500).send('Error during the authorization process.');
    }
});

// Step 4: Make an API request to retrieve sleep data and save it to a CSV file
app.get('/get-sleep-data', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0]; // Today's date in yyyy-MM-dd format
        const limit = 100; // Max number of records per request
        const allSleepData = []; // Full array to store all of the sleep data
        let offset = 0;
        let hasMoreData = true;

        while (hasMoreData) {
            //Make call to get data from fitbit for the auth user
            const sleepResponse = await axios.get('https://api.fitbit.com/1.2/user/-/sleep/list.json', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept-Language': 'en_US' // Adjust as needed
                },
                params: {
                    beforeDate: today,
                    sort: 'desc',
                    offset,
                    limit,
                }
            });
            
            //Save response and push it to full sleep data array
            const sleepData = sleepResponse.data.sleep;
            allSleepData.push(...sleepData);

            // Check if there is more data to fetch
            if (sleepData.length < limit) {
                hasMoreData = false;
            } else {
                offset += limit;
            }
        }

        // Prepare CSV content
        //First bit is field names
        //Return are values from json structure to load into the csv
        const csvContent = [
            "Device ID,Log ID,Date/Time of Sleep Start,Date/Time of Sleep End,Minutes to Fall Asleep,Minutes Asleep,Minutes Awake,Deep Stage Count,Deep Stage Minutes,Light Stage Count,Light Stage Minutes,REM Stage Count,REM Stage Minutes,Wake Stage Count,Wake Stage Minutes,\n",
            ...allSleepData.map(record => {
                return `${record.deviceId || 'N/A'},${record.logId},${record.startTime},${record.endTime},${record.minutesToFallAsleep || 'N/A'},${record.minutesAsleep},${record.minutesAwake},${record.levels.summary.deep.count},${record.levels.summary.deep.minutes},${record.levels.summary.light.count},${record.levels.summary.light.minutes},${record.levels.summary.rem.count},${record.levels.summary.rem.minutes},${record.levels.summary.wake.count},${record.levels.summary.wake.minutes}`;
            })
        ].join('\n');

        // Save to file with date associated
        const filePath = path.join(__dirname, `sleep_data_${today}.csv`);
        fs.writeFileSync(filePath, csvContent);

        // Send file as download
        res.download(filePath);
    } catch (error) {
        console.error('Error fetching sleep data:', error);

        if (error.response && error.response.status === 401) {
            // Token expired, handle refresh
            await refreshAccessToken(); // Implement your token refresh logic here
            res.redirect('/get-sleep-data');
        } else {
            res.status(500).send('Error retrieving sleep data.');
        }
    }
});

// Function to refresh the access token using the refresh token
async function refreshAccessToken() {
    try {
        const tokenResponse = await axios.post('https://api.fitbit.com/oauth2/token', null, {
            params: {
                client_id: clientId,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${clientId}:${process.env.CLIENT_SECRET}`).toString('base64')}`
            }
        });

        accessToken = tokenResponse.data.access_token;
        refreshToken = tokenResponse.data.refresh_token;
    } catch (error) {
        console.error('Error refreshing access token:', error);
    }
}

const port = process.env.PORT || 3001;
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
