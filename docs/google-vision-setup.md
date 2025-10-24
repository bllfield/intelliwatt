# Google Vision API Configuration

## Required Environment Variables

Add these to your `.env.local` file or Vercel environment variables:

```bash
# Google Cloud Project Configuration
GOOGLE_PROJECT_ID=your-project-id
GOOGLE_PRIVATE_KEY_ID=your-private-key-id
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"
GOOGLE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_CLIENT_ID=your-client-id
```

## Setup Instructions

### 1. Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Vision API

### 2. Create Service Account
1. Go to IAM & Admin > Service Accounts
2. Click "Create Service Account"
3. Name: "intelliwatt-vision-api"
4. Role: "Cloud Vision API User"
5. Click "Create Key" > "JSON"
6. Download the JSON file

### 3. Extract Credentials
From the downloaded JSON file, extract:
- `project_id` → `GOOGLE_PROJECT_ID`
- `private_key_id` → `GOOGLE_PRIVATE_KEY_ID`
- `private_key` → `GOOGLE_PRIVATE_KEY`
- `client_email` → `GOOGLE_CLIENT_EMAIL`
- `client_id` → `GOOGLE_CLIENT_ID`

### 4. Configure Environment Variables
Add the extracted values to your environment configuration.

## API Usage

### Endpoint: `/api/vision/analyze-address`
- **Method**: POST
- **Content-Type**: multipart/form-data
- **Body**: image file
- **Response**: JSON with extracted address components

### Example Usage
```javascript
const formData = new FormData();
formData.append('image', imageFile);

const response = await fetch('/api/vision/analyze-address', {
  method: 'POST',
  body: formData,
});

const result = await response.json();
```

### Response Format
```json
{
  "success": true,
  "extractedText": "123 Main St\nHouston, TX 77001",
  "address": {
    "street": "123 Main St",
    "city": "Houston",
    "state": "TX",
    "zipCode": "77001",
    "fullAddress": "123 Main St, Houston, TX, 77001"
  },
  "confidence": 0.95
}
```

## Features

- **Text Extraction**: Uses Google Vision API to read text from images
- **Smart Parsing**: Automatically identifies address components
- **US Address Support**: Recognizes all US states and common address formats
- **Error Handling**: Robust error management
- **File Format Support**: JPEG, PNG, GIF, BMP, WEBP
- **File Size Limit**: 10MB maximum

## Integration

The `AddressImageUpload` component can be integrated into your existing address collection system:

```tsx
import AddressImageUpload from '@/components/AddressImageUpload';

// Add to your dashboard or address collection page
<AddressImageUpload />
```

## Testing

You can test the API endpoint directly:

```bash
curl -X POST \
  -F "image=@/path/to/address-image.jpg" \
  http://localhost:3000/api/vision/analyze-address
```
