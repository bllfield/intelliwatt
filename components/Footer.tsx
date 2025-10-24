'use client';

import { useState } from 'react';

export default function Footer() {
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  const handleAdminClick = () => {
    setShowAdminLogin(true);
  };

  return (
    <>
      <footer className="bg-brand-navy text-brand-blue py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center mb-4">
                <div className="relative w-16 h-16">
                  <img
                    src="/IntelliWatt Logo.png"
                    alt="IntelliWatt™ Logo"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
              <p className="text-sm text-brand-blue/80 mb-4">
                Optimize your energy usage and find the best electricity plans with AI-powered insights.
              </p>
            </div>
            
            <div>
              <h4 className="text-sm font-semibold text-brand-blue mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-brand-blue/80">
                <li><a href="/how-it-works" className="hover:text-brand-white transition-colors">How It Works</a></li>
                <li><a href="/faq" className="hover:text-brand-white transition-colors">FAQ</a></li>
                <li><a href="/privacy-policy" className="hover:text-brand-white transition-colors">Privacy Policy</a></li>
                <li><a href="/rules" className="hover:text-brand-white transition-colors">Rules</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-sm font-semibold text-brand-blue mb-3">Support</h4>
              <ul className="space-y-2 text-sm text-brand-blue/80">
                <li><a href="/join" className="hover:text-brand-white transition-colors">Join</a></li>
                <li><a href="/login" className="hover:text-brand-white transition-colors">Login</a></li>
                <li><a href="/dashboard" className="hover:text-brand-white transition-colors">Dashboard</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-sm font-semibold text-brand-blue mb-3">Admin</h4>
              <ul className="space-y-2 text-sm text-brand-blue/80">
                <li>
                  <button 
                    onClick={handleAdminClick}
                    className="hover:text-brand-white transition-colors text-sm font-medium"
                  >
                    Admin Access
                  </button>
                </li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-brand-blue/20 mt-8 pt-6 text-center text-sm text-brand-blue/60">
            <p>&copy; 2024 IntelliWatt™. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Admin Login Modal */}
      {showAdminLogin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="text-center">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Admin Access</h3>
              <p className="text-sm text-gray-600 mb-6">
                Admin access is secured with magic link authentication. Click below to request access.
              </p>
              <div className="space-y-3">
                <a
                  href="/admin-login"
                  className="w-full bg-brand-blue text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors inline-block"
                >
                  Request Admin Access
                </a>
                <button
                  onClick={() => setShowAdminLogin(false)}
                  className="w-full bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
