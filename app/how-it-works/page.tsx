import Image from 'next/image';
import Link from 'next/link';

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-6">
            How <span className="text-brand-blue">IntelliWatt™</span> Works
          </h1>
          <p className="text-xl text-brand-white mb-8 max-w-2xl mx-auto leading-relaxed">
            Our AI-powered platform analyzes your energy usage and finds the best plan for your home.
          </p>
        </div>
      </section>

      {/* Process Steps */}
      <section className="py-16 px-4 bg-brand-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-12">
            {/* Step 1 */}
            <div className="text-center group">
              <div className="w-24 h-24 bg-brand-navy rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-blue font-bold text-3xl">1</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Connect Your Data</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                Link your smart meter or upload your energy bills. We securely access your usage data to understand your unique patterns.
              </p>
            </div>
            
            {/* Step 2 */}
            <div className="text-center group">
              <div className="w-24 h-24 bg-brand-navy rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-blue font-bold text-3xl">2</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">AI Analysis</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                Our advanced algorithms analyze your usage patterns, weather data, and market conditions to find the optimal plan.
              </p>
            </div>
            
            {/* Step 3 */}
            <div className="text-center group">
              <div className="w-24 h-24 bg-brand-navy rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-blue font-bold text-3xl">3</span>
              </div>
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Easy Enrollment</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                We guide you through the enrollment process. No phone calls, no paperwork — just easy sign-up and savings.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Detailed Process */}
      <section className="py-16 px-4 bg-brand-navy">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-brand-white text-center mb-12">
            The <span className="text-brand-blue">Complete</span> Process
          </h2>
          
          <div className="space-y-12">
            {/* Step 1 Detail */}
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="flex-shrink-0">
                <div className="w-32 h-32 bg-brand-white rounded-full flex items-center justify-center">
                  <span className="text-brand-blue text-4xl">📊</span>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-brand-white mb-4">Data Collection & Analysis</h3>
                <p className="text-brand-white text-lg leading-relaxed mb-4">
                  We securely connect to your Smart Meter Texas account or accept manual uploads of your energy bills. Our system analyzes:
                </p>
                <ul className="text-brand-white space-y-2">
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    Hourly, daily, and monthly usage patterns
                  </li>
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    Seasonal variations and weather correlations
                  </li>
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    Peak usage times and demand patterns
                  </li>
                </ul>
              </div>
            </div>

            {/* Step 2 Detail */}
            <div className="flex flex-col md:flex-row-reverse items-center gap-8">
              <div className="flex-shrink-0">
                <div className="relative w-32 h-32 bg-brand-white rounded-full flex items-center justify-center shadow-[0_15px_40px_rgba(15,23,42,0.25)]">
                  <Image
                    src="/Intelliwatt Bot Final Gif.gif"
                    alt="IntelliWatt Bot"
                    width={70}
                    height={70}
                    className="rounded-full object-contain"
                    unoptimized
                    priority
                  />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-brand-white mb-4">AI-Powered Optimization</h3>
                <p className="text-brand-white text-lg leading-relaxed mb-4">
                  Our patent-pending AI engine processes your data through multiple algorithms to find the perfect plan match:
                </p>
                <ul className="text-brand-white space-y-2">
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    Pattern matching with similar households
                  </li>
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    Weather normalization and seasonal adjustments
                  </li>
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    Real-time market analysis and rate comparisons
                  </li>
                </ul>
              </div>
            </div>

            {/* Step 3 Detail */}
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="flex-shrink-0">
                <div className="w-32 h-32 bg-brand-white rounded-full flex items-center justify-center">
                  <span className="text-brand-blue text-4xl">⚡</span>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-brand-white mb-4">Seamless Switching</h3>
                <p className="text-brand-white text-lg leading-relaxed mb-4">
                  Once we identify the best plan, we handle everything for you:
                </p>
                <ul className="text-brand-white space-y-2">
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    Easy plan enrollment and sign-up
                  </li>
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    No interruption to your service
                  </li>
                  <li className="flex items-center">
                    <span className="text-brand-blue mr-2">•</span>
                    Continuous monitoring for better options
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Technology Section */}
      <section className="py-16 px-4 bg-brand-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-brand-navy text-center mb-12">
            Our <span className="text-brand-blue">Technology</span>
          </h2>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-brand-navy border border-brand-blue/30 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-[#00E0FF] mb-4">Smart Meter Integration</h3>
              <p className="text-[#00E0FF]/80 mb-4">
                Direct integration with Smart Meter Texas provides real-time, accurate usage data for the most precise recommendations.
              </p>
              <ul className="space-y-2 text-[#00E0FF]">
                <li className="flex items-center gap-2">
                  <span className="text-brand-blue">✓</span>
                  Real-time data access
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-brand-blue">✓</span>
                  Bank-level security
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-brand-blue">✓</span>
                  No manual data entry needed
                </li>
              </ul>
            </div>

            <div className="bg-brand-navy border border-brand-blue/30 rounded-2xl p-6">
              <h3 className="text-xl font-bold text-[#00E0FF] mb-4">AI Engine</h3>
              <p className="text-[#00E0FF]/80 mb-4">
                Our proprietary AI algorithms analyze millions of data points to find the optimal energy plan for your specific needs.
              </p>
              <ul className="space-y-2 text-[#00E0FF]">
                <li className="flex items-center gap-2">
                  <span className="text-brand-blue">✓</span>
                  Advanced machine learning algorithms
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-brand-blue">✓</span>
                  Continuous learning
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-brand-blue">✓</span>
                  Weather normalization
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 bg-brand-navy">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-brand-white mb-6">
            Ready to <span className="text-brand-blue">Start Saving</span>?
          </h2>
          <p className="text-brand-white mb-8 max-w-2xl mx-auto">
            Join thousands of Texans who are already saving money with IntelliWatt™. It only takes 2 minutes to get started.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/join" className="bg-brand-blue text-brand-navy font-bold py-4 px-8 rounded-full text-lg border-2 border-brand-blue hover:border-brand-white transition-all duration-300">
              Get Started Free
            </Link>
            <Link href="/faq" className="text-brand-white border-2 border-brand-blue px-8 py-4 rounded-full font-semibold hover:bg-brand-blue hover:text-brand-navy transition-all duration-300">
              Learn More
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
} 