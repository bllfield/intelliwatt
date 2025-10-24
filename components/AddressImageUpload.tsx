'use client';

import { useState, useRef } from 'react';

interface AddressComponents {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  fullAddress?: string;
}

interface VisionResponse {
  success: boolean;
  extractedText: string;
  address: AddressComponents;
  confidence: number;
  error?: string;
}

export default function AddressImageUpload() {
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VisionResponse | null>(null);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImage(file);
      setError('');
      setResult(null);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!image) {
      setError('Please select an image first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('image', image);

      const response = await fetch('/api/vision/analyze-address', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || 'Failed to analyze image');
      }
    } catch (err) {
      setError('Network error. Please try again.');
      console.error('Analysis error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUseAddress = async () => {
    if (result?.address) {
      setLoading(true);
      try {
        // Get user ID from cookie or session
        const userResponse = await fetch('/api/admin/user/dashboard');
        if (!userResponse.ok) {
          throw new Error('User not authenticated');
        }
        const userData = await userResponse.json();
        
        // Convert extracted address to Google Place Details format
        const googlePlaceDetails = {
          place_id: null,
          formatted_address: result.address.fullAddress || '',
          address_components: [
            { long_name: result.address.street || '', short_name: result.address.street || '', types: ['street_address'] },
            { long_name: result.address.city || '', short_name: result.address.city || '', types: ['locality'] },
            { long_name: result.address.state || '', short_name: result.address.state || '', types: ['administrative_area_level_1'] },
            { long_name: result.address.zipCode || '', short_name: result.address.zipCode || '', types: ['postal_code'] },
            { long_name: 'United States', short_name: 'US', types: ['country'] }
          ],
          geometry: {
            location: null
          }
        };

        const response = await fetch('/api/address/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: userData.user?.email || 'unknown', // Use email as userId for now
            houseId: null,
            googlePlaceDetails: googlePlaceDetails,
            smartMeterConsent: false, // User can check this separately
            smartMeterConsentDate: null
          })
        });

        if (response.ok) {
          const data = await response.json();
          alert(`Address saved successfully! Address ID: ${data.address.id}`);
          // Reset the form after successful save
          resetForm();
        } else {
          const error = await response.json();
          alert(error.error || 'Failed to save address');
        }
      } catch (err) {
        console.error('Error saving address:', err);
        alert('Failed to save address');
      } finally {
        setLoading(false);
      }
    }
  };

  const resetForm = () => {
    setImage(null);
    setPreview('');
    setResult(null);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-brand-navy shadow-lg">
      <div className="flex items-center mb-4">
        <div className="w-8 h-8 bg-brand-blue rounded-full flex items-center justify-center mr-3">
          <span className="text-white text-sm">📷</span>
        </div>
        <h3 className="text-xl font-bold text-brand-navy">Extract Address from Image</h3>
      </div>

      <div className="space-y-4">
        {/* Image Upload */}
        <div>
          <label className="block text-brand-navy font-semibold mb-2">
            Upload Address Image
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="w-full px-4 py-3 rounded-lg bg-white border-2 border-brand-navy text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition-all duration-300"
          />
          <p className="text-sm text-brand-navy/60 mt-1">
            Supported formats: JPEG, PNG, GIF, BMP, WEBP (max 10MB)
          </p>
        </div>

        {/* Image Preview */}
        {preview && (
          <div className="space-y-2">
            <label className="block text-brand-navy font-semibold">Preview:</label>
            <div className="border-2 border-brand-navy rounded-lg p-4 bg-gray-50">
              <img 
                src={preview} 
                alt="Address preview" 
                className="max-w-full max-h-64 mx-auto rounded"
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <button
            onClick={handleAnalyze}
            disabled={!image || loading}
            className="flex-1 bg-brand-blue text-white py-3 px-6 rounded-lg font-semibold hover:bg-brand-blue/90 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Analyzing...' : 'Extract Address'}
          </button>
          
          <button
            onClick={resetForm}
            className="px-6 py-3 border-2 border-brand-navy text-brand-navy rounded-lg font-semibold hover:bg-brand-navy hover:text-white transition-all duration-300"
          >
            Reset
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Results Display */}
        {result && (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h4 className="text-green-800 font-semibold mb-2">Extracted Address:</h4>
              {result.address?.fullAddress ? (
                <div className="space-y-2">
                  <p className="text-green-800 font-medium">{result.address.fullAddress}</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {result.address.street && (
                      <div><span className="font-medium">Street:</span> {result.address.street}</div>
                    )}
                    {result.address.city && (
                      <div><span className="font-medium">City:</span> {result.address.city}</div>
                    )}
                    {result.address.state && (
                      <div><span className="font-medium">State:</span> {result.address.state}</div>
                    )}
                    {result.address.zipCode && (
                      <div><span className="font-medium">ZIP:</span> {result.address.zipCode}</div>
                    )}
                  </div>
                  <p className="text-xs text-green-600">
                    Confidence: {Math.round(result.confidence * 100)}%
                  </p>
                </div>
              ) : (
                <p className="text-green-800">No address components found in the image.</p>
              )}
            </div>

            {/* Extracted Text */}
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <h4 className="text-gray-800 font-semibold mb-2">Extracted Text:</h4>
              <p className="text-gray-700 text-sm whitespace-pre-wrap">{result.extractedText}</p>
            </div>

            {/* Use Address Button */}
            {result.address?.fullAddress && (
              <button
                onClick={handleUseAddress}
                disabled={loading}
                className="w-full bg-brand-navy text-brand-blue py-3 px-6 rounded-lg font-semibold hover:bg-brand-navy/90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Saving Address...' : 'Save This Address'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
