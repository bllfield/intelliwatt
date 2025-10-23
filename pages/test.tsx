import Link from 'next/link';

export default function TestPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-8">Test Page</h1>
        <p className="text-xl text-gray-300 mb-8">
          If you can see this, routing is working!
        </p>
        <div className="space-y-4">
          <Link
            href="/"
            className="block bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-white font-bold py-3 px-6 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg"
          >
            Go Home
          </Link>
          <Link
            href="/privacy-policy"
            className="block bg-gradient-to-r from-green-400 to-green-500 hover:from-green-500 hover:to-green-600 text-white font-bold py-3 px-6 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg"
          >
            Go to Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
} 