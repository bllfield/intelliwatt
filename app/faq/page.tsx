'use client';

import { useState } from 'react';
import Image from 'next/image';

interface FAQItem {
  question: string;
  answer: string;
}

const faqData: FAQItem[] = [
  {
    question: "How does IntelliWatt™ save me money?",
    answer: "IntelliWatt uses AI to analyze your actual energy usage patterns and automatically finds the best electricity plan for your specific needs. We handle the switching process and continuously monitor for better options."
  },
  {
    question: "Is IntelliWatt™ really free?",
    answer: "Yes! IntelliWatt is completely free to use. We earn commissions from energy providers when we switch you to a better plan, so you save money and we earn money — it's a win-win."
  },
  {
    question: "How do Jackpot entries work?",
    answer: "Every action you take on IntelliWatt earns you entries into our monthly jackpot drawing. Complete your profile, refer friends, and use our features to earn more entries and increase your chances of winning."
  },
  {
    question: "Is my data secure?",
    answer: "Absolutely. We use bank-level encryption to protect your data. We only access the information needed to find you the best energy plan, and we never sell your personal information to third parties."
  },
  {
    question: "How accurate are the savings estimates?",
    answer: "Our AI engine achieves 94% accuracy by using your actual smart meter data and accounting for weather patterns, seasonal changes, and your unique usage habits. No estimates or averages — just real data."
  },
  {
    question: "What if I'm not satisfied with the switch?",
    answer: "We stand behind our recommendations. If you're not happy with your new plan, we'll help you switch back or find a better option. Your satisfaction is our priority."
  },
  {
    question: "Do I need a smart meter to use IntelliWatt?",
    answer: "While smart meter data provides the most accurate results, you can also manually enter your usage data. We'll work with whatever information you can provide to find you the best plan."
  },
  {
    question: "How often does IntelliWatt check for better plans?",
    answer: "We continuously monitor the market and your usage patterns. You'll receive alerts whenever we find a plan that could save you money, typically checking monthly or when new plans become available."
  }
];

export default function FAQPage() {
  const [openItems, setOpenItems] = useState<number[]>([]);

  const toggleItem = (index: number) => {
    setOpenItems(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-6xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-brand-white mb-6">
            Frequently Asked <span className="text-brand-blue">Questions</span>
          </h1>
          <p className="text-xl text-brand-white max-w-3xl mx-auto leading-relaxed">
            Everything you need to know about IntelliWatt™ and how we help you save on your energy bills.
          </p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto">
          <div className="space-y-8">
            {/* FAQ Item 1 */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300">
              <h3 className="text-2xl font-bold text-brand-navy mb-4">How does IntelliWatt™ work?</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                IntelliWatt™ connects to your smart meter or analyzes your energy bills to understand your unique usage patterns. 
                Our AI then finds the perfect energy plan that matches your specific needs, potentially saving you hundreds of dollars annually.
              </p>
            </div>

            {/* FAQ Item 2 */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300">
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Is IntelliWatt™ really free?</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                Yes! IntelliWatt™ is completely free to use. We make money through partnerships with energy providers when you switch to a better plan, 
                but there are no hidden fees or charges for our service.
              </p>
            </div>

            {/* FAQ Item 3 */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300">
              <h3 className="text-2xl font-bold text-brand-navy mb-4">How much can I save?</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                Our users save an average of $847 annually, but your savings depend on your current plan and usage patterns. 
                Some users save as much as $1,200+ per year by switching to optimized plans.
              </p>
            </div>

            {/* FAQ Item 4 */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300">
              <h3 className="text-2xl font-bold text-brand-navy mb-4">What if I don't have a smart meter?</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                No problem! You can upload your recent energy bills and we'll analyze your usage patterns from that data. 
                While smart meter data provides the most accurate results, we can still find significant savings with bill data.
              </p>
            </div>

            {/* FAQ Item 5 */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300">
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Is my data secure?</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                Absolutely. We use bank-level encryption to protect your data. We never sell your personal information and only use your usage data 
                to find better energy plans for you.
              </p>
            </div>

            {/* FAQ Item 6 */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300">
              <h3 className="text-2xl font-bold text-brand-navy mb-4">How long does it take to see savings?</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                You'll see savings on your very next bill after switching to a better plan. The switching process typically takes 1-2 billing cycles, 
                and we handle all the paperwork for you.
              </p>
            </div>

            {/* FAQ Item 7 */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300">
              <h3 className="text-2xl font-bold text-brand-navy mb-4">What if I'm not satisfied?</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                We're confident you'll love the savings, but if you're not satisfied, you can cancel anytime with no fees. 
                We'll even help you switch back to your previous provider if needed.
              </p>
            </div>

            {/* FAQ Item 8 */}
            <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg hover:border-brand-blue transition-all duration-300">
              <h3 className="text-2xl font-bold text-brand-navy mb-4">Do you work with all energy providers?</h3>
              <p className="text-brand-navy text-lg leading-relaxed">
                We have access to most of the major energy providers in your area to ensure you get access to the best available plans. 
                Our AI analyzes all available options to find the perfect match for your usage patterns.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 bg-brand-navy">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white mb-8">
            Ready to Start <span className="text-brand-blue">Saving</span>?
          </h2>
          <p className="text-xl text-brand-white mb-12 max-w-3xl mx-auto">
            Join thousands of homeowners who are already saving hundreds on their energy bills with IntelliWatt™.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a href="/join" className="bg-brand-blue text-brand-navy font-bold py-4 px-8 rounded-full text-lg hover:bg-brand-cyan transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-brand-blue/25">
              Get Started Free
            </a>
            <a href="/how-it-works" className="text-brand-white border-2 border-brand-blue px-8 py-4 rounded-full font-semibold hover:bg-brand-blue hover:text-brand-navy transition-all duration-300">
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-4 bg-brand-navy border-t border-brand-blue/20">
        <div className="max-w-6xl mx-auto">
          {/* Main Footer Content */}
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            {/* Company Info */}
            <div className="md:col-span-2">
              <div className="flex items-center mb-6">
                <div className="relative w-32 h-16 mr-4">
                  <Image
                    src="/IntelliWatt Logo TM.png"
                    alt="IntelliWatt™ Logo"
                    fill
                    className="object-contain"
                  />
                </div>
              </div>
              <p className="text-brand-white text-lg leading-relaxed mb-6 max-w-md">
                Stop overpaying for power with our AI-powered energy plan optimization. 
                Smart algorithms find the perfect plan for your unique usage patterns.
              </p>
              
              <div className="flex space-x-4">
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
                  </svg>
                </a>
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/>
                  </svg>
                </a>
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>
              </div>
            </div>
            
            {/* Quick Links */}
            <div>
              <h3 className="text-brand-white font-semibold mb-4">Quick Links</h3>
              <ul className="space-y-2">
                <li><a href="/how-it-works" className="text-brand-white hover:text-brand-blue transition-colors">How It Works</a></li>
                <li><a href="/faq" className="text-brand-white hover:text-brand-blue transition-colors">FAQ</a></li>
                <li><a href="/privacy" className="text-brand-white hover:text-brand-blue transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="text-brand-white hover:text-brand-blue transition-colors">Terms of Service</a></li>
              </ul>
            </div>
            
            {/* Support */}
            <div>
              <h3 className="text-brand-white font-semibold mb-4">Support</h3>
              <ul className="space-y-2">
                <li><a href="/contact" className="text-brand-white hover:text-brand-blue transition-colors">Contact Us</a></li>
                <li><a href="/help" className="text-brand-white hover:text-brand-blue transition-colors">Help Center</a></li>
                <li><a href="/status" className="text-brand-white hover:text-brand-blue transition-colors">Service Status</a></li>
              </ul>
            </div>
          </div>
          
          {/* Bottom Footer */}
          <div className="border-t border-brand-blue/20 pt-8 text-center">
            <p className="text-brand-white">
              © 2024 IntelliWatt™. All rights reserved. Patent pending.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
} 