import Link from 'next/link';

export default function Custom404() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white mb-4">404</h1>
        <p className="text-xl text-gray-300 mb-8">
          Oops! The page you're looking for doesn't exist.
        </p>
        <Link
          href="/"
          className="bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-white font-bold py-3 px-6 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg inline-block"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
} 