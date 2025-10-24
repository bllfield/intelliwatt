# Google Maps API Setup for IntelliWatt

## Required Environment Variable

You need to set up the Google Maps API key for address autocomplete functionality:

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_api_key_here
```

## Setup Steps

### 1. Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the following APIs:
   - **Maps JavaScript API**
   - **Places API**

### 2. Create API Key
1. Go to "APIs & Services" > "Credentials"
2. Click "+ CREATE CREDENTIALS" > "API Key"
3. Copy the generated API key

### 3. Restrict API Key (Recommended)
1. Click on your API key to edit it
2. Under "Application restrictions":
   - Select "HTTP referrers (web sites)"
   - Add your domains:
     - `https://intelliwatt.com/*`
     - `https://intelliwatt.vercel.app/*`
     - `http://localhost:3000/*` (for development)
3. Under "API restrictions":
   - Select "Restrict key"
   - Choose: "Maps JavaScript API" and "Places API"
4. Click "Save"

### 4. Set Environment Variable

**For Vercel (Production):**
1. Go to your Vercel project dashboard
2. Navigate to "Settings" > "Environment Variables"
3. Add:
   - **Name**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
   - **Value**: `your_api_key_here`
   - **Environment**: Production, Preview, Development

**For Local Development:**
1. Create `.env.local` file in project root
2. Add:
   ```
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_api_key_here
   ```

### 5. Deploy
After setting the environment variable, redeploy your application. The address field will now have Google Places autocomplete functionality.

## Features Enabled

With the API key configured:
- ✅ **Real-time address suggestions** as you type
- ✅ **US-only address filtering**
- ✅ **Formatted address auto-population**
- ✅ **Google Places integration**
- ✅ **Automatic geocoding**

Without the API key:
- ✅ **Manual address entry** still works
- ✅ **No errors or console warnings**
- ✅ **Graceful fallback**

## Troubleshooting

**If autocomplete isn't working:**
1. Check browser console for API key errors
2. Verify the API key is correctly set in environment variables
3. Ensure the APIs (Maps JavaScript API, Places API) are enabled
4. Check that the API key restrictions allow your domain

**Common errors:**
- `InvalidKeyMapError`: API key is missing or invalid
- `RefererNotAllowedMapError`: Domain not in API key restrictions
- `QuotaExceededError`: API usage limits exceeded
