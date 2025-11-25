"use client";

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const LandingPage: React.FC = () => {
  const searchParams = useSearchParams();
  const from = searchParams?.get('from');
  const source = searchParams?.get('source');
  const showJackpotBanner = from === 'htjw' || source === 'jackpot';
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
      </div>

      {/* 1. Announcement Banner - Only show when coming from HitTheJackWatt */}
      {showJackpotBanner && (
        <section className="bg-gradient-to-r from-brand-blue to-brand-cyan py-3 text-center text-brand-navy font-semibold text-lg">
          🎉 You've unlocked IntelliWatt! This is where you track savings, referrals, and <span className="underline">earn more Jackpot entries</span>.
        </section>
      )}

      {/* 2. Address Entry Section (above Hero) */}
      <section className="relative py-12 px-4 bg-gradient-to-r from-brand-blue/5 to-brand-cyan/10 backdrop-blur-sm border-b border-brand-blue/10">
        <div className="max-w-4xl mx-auto">
          <label htmlFor="address" className="block text-brand-white font-semibold text-xl mb-6 text-center">
            Enter Your Home Address
          </label>
          <div className="relative group">
            <input
              type="text"
              id="address"
              placeholder="Start typing your address..."
              className="w-full px-6 py-4 rounded-xl bg-brand-navy/50 border-2 border-brand-blue/20 text-brand-white placeholder-brand-cyan/50 focus:outline-none focus:ring-4 focus:ring-brand-blue/50 focus:border-brand-blue transition-all duration-300 backdrop-blur-sm text-lg"
              // TODO: Add Google Places Autocomplete API integration
              // TODO: Implement address validation and geocoding
            />
            <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
              <svg className="w-6 h-6 text-brand-cyan group-hover:text-brand-blue transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          {/* TODO: Add address suggestions dropdown */}
          {/* TODO: Add address validation feedback */}
        </div>
      </section>

      {/* 3. Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-5xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-bold text-brand-white mb-6 leading-tight animate-fade-in-up">
            Stop Overpaying for{' '}
            <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">
              Power
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-brand-cyan mb-8 max-w-3xl mx-auto animate-fade-in-up delay-200">
            IntelliWatt tracks your electric plan and alerts you when it's time to switch — automatically.
          </p>

          <a
            href="/register"
            className="inline-block bg-brand-blue hover:bg-brand-cyan text-brand-navy font-bold py-3 px-6 rounded-full transition-all duration-300 animate-fade-in-up delay-300"
          >
            Unlock Your IntelliWatt Dashboard →
          </a>

          {/* IntelliWatt Bot GIF + Quote */}
          <div className="mt-12 animate-fade-in-up delay-400">
            <p className="text-brand-cyan font-medium text-lg mb-2">
              IntelliWatt Bot is your 24/7 energy assistant — always working in the background to lower your bills and give you one less thing to worry about.
            </p>
            <Image
              src="/Intelliwatt Bot Final Gif.gif"
              alt="IntelliWatt Bot"
              width={200}
              height={200}
              className="mx-auto rounded-lg"
              priority
              unoptimized
            />
            <p className="mt-4 text-brand-cyan text-lg font-medium max-w-xl mx-auto italic">
              "I'll keep up with your plan options and figure out your best option — so you don't have to."
            </p>
          </div>
        </div>
      </section>

      {/* 3. How It Works Section */}
      <section className="py-24 px-4 bg-gradient-to-b from-brand-blue/5 to-transparent">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white text-center mb-20">
            How It <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">Works</span>
          </h2>
          
          <div className="grid md:grid-cols-3 gap-12">
            {/* Step 1 */}
            <div className="text-center group">
              <div className="w-20 h-20 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-navy font-bold text-2xl">1</span>
              </div>
              <h3 className="text-2xl font-semibold text-brand-white mb-4">Link Your Power Usage</h3>
              <p className="text-brand-cyan text-lg leading-relaxed">Connect your smart meter or upload your bills securely</p>
            </div>
            
            {/* Step 2 */}
            <div className="text-center group">
              <div className="w-20 h-20 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-navy font-bold text-2xl">2</span>
              </div>
              <h3 className="text-2xl font-semibold text-brand-white mb-4">We Run the Numbers</h3>
              <p className="text-brand-cyan text-lg leading-relaxed">Our AI analyzes your unique usage patterns and preferences</p>
            </div>
            
            {/* Step 3 */}
            <div className="text-center group">
              <div className="w-20 h-20 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <span className="text-brand-navy font-bold text-2xl">3</span>
              </div>
              <h3 className="text-2xl font-semibold text-brand-white mb-4">Switch and Save Automatically</h3>
              <p className="text-brand-cyan text-lg leading-relaxed">We handle the switch while you enjoy the savings — and automatically earn <strong>Jackpot entries</strong> for every action.</p>
            </div>
          </div>
          
          {/* Bonus CTA Section */}
          <div className="text-center mt-12">
            <p className="text-brand-white text-xl mb-4">🎁 Bonus: Every action here earns more entries toward the jackpot drawing!</p>
            <a href="/register" className="inline-block bg-brand-cyan text-brand-navy font-bold px-6 py-3 rounded-full hover:bg-brand-blue transition-all duration-300">
              Start Now →
            </a>
          </div>
        </div>
      </section>

      {/* 4. Why IntelliWatt Works Better Section */}
      <section className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-brand-white mb-6">
              Why <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">IntelliWatt™</span> Works Better
            </h2>
            <p className="text-xl text-brand-cyan max-w-4xl mx-auto leading-relaxed">
              We don't just show you prices — we calculate what your home actually needs using advanced AI algorithms.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8 mb-16">
            <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 hover:border-brand-blue/30 transition-all duration-300 group">
              <div className="w-12 h-12 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-3">Real Smart Meter Data</h3>
              <p className="text-brand-cyan">Uses actual usage data — no estimates or averages</p>
            </div>
            <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 hover:border-brand-blue/30 transition-all duration-300 group">
              <div className="w-12 h-12 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-3">Weather & Season Normalization</h3>
              <p className="text-brand-cyan">Accounts for weather, usage timing, and seasonal changes</p>
            </div>
            <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 hover:border-brand-blue/30 transition-all duration-300 group">
              <div className="w-12 h-12 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-3">Pattern Matching</h3>
              <p className="text-brand-cyan">Matches your home's unique usage pattern to the best-fit plan</p>
            </div>
            <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 hover:border-brand-blue/30 transition-all duration-300 group">
              <div className="w-12 h-12 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-3">Patent-Pending Engine</h3>
              <p className="text-brand-cyan">Advanced switching engine — only available at IntelliWatt™</p>
            </div>
            <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 hover:border-brand-blue/30 transition-all duration-300 group md:col-span-2">
              <div className="w-12 h-12 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-6 h-6 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-3">Continuous Monitoring</h3>
              <p className="text-brand-cyan">Re-checks automatically so you never overpay again</p>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-xl text-brand-blue font-semibold bg-gradient-to-r from-brand-blue/10 to-brand-cyan/10 p-6 rounded-2xl border border-brand-blue/20">
              Backed by patented algorithms that beat guesswork — every time.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Plan Comparison Tool Placeholder */}
      <section className="py-24 px-4 bg-gradient-to-b from-brand-blue/5 to-transparent">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white mb-8">
            Plan <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">Comparison</span> Tool
          </h2>
          <div className="bg-gradient-to-br from-brand-navy/50 to-brand-navy/80 h-80 rounded-2xl flex items-center justify-center border border-brand-blue/10 backdrop-blur-sm">
            <div className="text-center">
              <svg className="w-16 h-16 text-brand-cyan mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-brand-cyan text-xl">Plan Comparison Tool (Coming Soon)</span>
            </div>
          </div>
          {/* TODO: Add energy plan savings calculator */}
          {/* TODO: Integrate with utility provider APIs */}
          {/* TODO: Add plan comparison table with switching costs */}
        </div>
      </section>

      {/* 6. Upload & Link Utility Data Section */}
      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white mb-8">
            Get Started with <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">Real Data</span>
          </h2>
          <p className="text-xl text-brand-cyan mb-16 text-lg max-w-3xl mx-auto">
            We use real usage data, not averages. Connect your smart meter or upload your bills to get started.
          </p>
          
          <div className="grid md:grid-cols-2 gap-8">
            <button className="group bg-gradient-to-r from-brand-blue to-brand-cyan hover:from-brand-cyan hover:to-brand-blue text-brand-navy font-bold py-8 px-8 rounded-2xl text-xl transition-all duration-300 transform hover:scale-105 shadow-2xl hover:shadow-brand-blue/25">
              <div className="flex items-center justify-center">
                <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload Your Electric Bill
              </div>
            </button>
            <button className="group bg-gradient-to-r from-brand-blue to-brand-cyan hover:from-brand-cyan hover:to-brand-blue text-brand-navy font-bold py-8 px-8 rounded-2xl text-xl transition-all duration-300 transform hover:scale-105 shadow-2xl hover:shadow-brand-blue/25">
              <div className="flex items-center justify-center">
                <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Link Your Smart Meter
              </div>
            </button>
          </div>
          
          {/* TODO: Add uploaded utility bill preview block */}
          {/* TODO: Implement Green Button / Smart Meter integrations */}
          {/* TODO: Add file upload progress indicator */}
          {/* TODO: Add bill parsing and data extraction logic */}
        </div>
      </section>

      {/* 7. Solar Interest Section */}
      <section className="py-24 px-4 bg-gradient-to-b from-brand-blue/5 to-transparent">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white mb-8">
            Thinking About <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">Solar</span>?
          </h2>
          <p className="text-xl text-brand-cyan mb-12 max-w-3xl mx-auto">
            Get a personalized solar optimization report and see how much you could save with solar panels.
          </p>
          <button className="group bg-gradient-to-r from-brand-blue to-brand-cyan hover:from-brand-cyan hover:to-brand-blue text-brand-navy font-bold py-6 px-12 rounded-full text-xl transition-all duration-300 transform hover:scale-105 shadow-2xl hover:shadow-brand-blue/25 mb-12">
            <span className="flex items-center justify-center">
              Get a Solar Optimization Report
              <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
          </button>
          <div className="bg-gradient-to-br from-brand-navy/50 to-brand-navy/80 h-64 rounded-2xl flex items-center justify-center border border-brand-blue/10 backdrop-blur-sm">
            <div className="text-center">
              <svg className="w-16 h-16 text-brand-cyan mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span className="text-brand-cyan text-xl">Solar Simulator (Coming Soon)</span>
            </div>
          </div>
          {/* TODO: Add solar simulator logic */}
          {/* TODO: Integrate with solar panel efficiency APIs */}
          {/* TODO: Add roof analysis and shading calculations */}
        </div>
      </section>

      {/* 8. Referral Rewards Section */}
      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white mb-6">
            <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">Referral</span> Rewards
          </h2>
          <p className="text-xl text-brand-cyan mb-12 max-w-3xl mx-auto">
            Win cash prizes, get free entries to our jackpot, and help your friends save money on their energy bills.
          </p>
          <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 h-64 rounded-2xl flex items-center justify-center border border-brand-blue/10 backdrop-blur-sm">
            <div className="text-center">
              <svg className="w-16 h-16 text-brand-cyan mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
              <span className="text-brand-cyan text-xl">Rewards Module (Coming Soon)</span>
            </div>
          </div>
          {/* TODO: Add referral system tracking */}
          {/* TODO: Implement Jackpot entry logic */}
          {/* TODO: Add referral code generation and tracking */}
          {/* TODO: Integrate with payment processing for rewards */}
        </div>
      </section>

      {/* 9. Testimonials / Trust Section */}
      <section className="py-24 px-4 bg-gradient-to-b from-brand-blue/5 to-transparent">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white text-center mb-20">
            What Our <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">Users</span> Say
          </h2>
          
          {/* Testimonials Placeholder */}
          <div className="grid md:grid-cols-3 gap-8 mb-20">
            <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center mr-4">
                  <span className="text-brand-navy font-bold">JS</span>
                </div>
                <div>
                  <h4 className="text-brand-white font-semibold">John Smith</h4>
                  <p className="text-brand-cyan text-sm">Homeowner</p>
                </div>
              </div>
              <p className="text-brand-cyan italic">"Testimonial 1 coming soon..."</p>
            </div>
            <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center mr-4">
                  <span className="text-brand-navy font-bold">MJ</span>
                </div>
                <div>
                  <h4 className="text-brand-white font-semibold">Mary Johnson</h4>
                  <p className="text-brand-cyan text-sm">Business Owner</p>
                </div>
              </div>
              <p className="text-brand-cyan italic">"Testimonial 2 coming soon..."</p>
            </div>
            <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center mr-4">
                  <span className="text-brand-navy font-bold">RW</span>
                </div>
                <div>
                  <h4 className="text-brand-white font-semibold">Robert Wilson</h4>
                  <p className="text-brand-cyan text-sm">Property Manager</p>
                </div>
              </div>
              <p className="text-brand-cyan italic">"Testimonial 3 coming soon..."</p>
            </div>
          </div>
          
          {/* Trust Badges */}
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center group">
              <div className="w-20 h-20 bg-gradient-to-r from-green-500 to-green-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-green-500/50 transition-all duration-300 transform group-hover:scale-110">
                <svg className="w-10 h-10 text-brand-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-2">100% Free</h3>
              <p className="text-brand-cyan">No hidden fees or charges</p>
            </div>
            <div className="text-center group">
              <div className="w-20 h-20 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <svg className="w-10 h-10 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-2">Secure Data</h3>
              <p className="text-brand-cyan">Bank-level encryption</p>
            </div>
            <div className="text-center group">
              <div className="w-20 h-20 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg group-hover:shadow-brand-blue/50 transition-all duration-300 transform group-hover:scale-110">
                <svg className="w-10 h-10 text-brand-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-brand-white mb-2">Powered by IntelliPath</h3>
              <p className="text-brand-cyan">Advanced AI technology</p>
              <p className="text-brand-cyan text-sm mt-2">
                You discovered us through <strong>HitTheJackWatt</strong> — now let's get to work saving you money.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 10. Login Portal Section (above Footer) */}
      <section className="py-24 px-4">
        <div className="max-w-md mx-auto">
          <h2 className="text-4xl font-bold text-brand-white text-center mb-8">
            Already a <span className="bg-gradient-to-r from-brand-blue to-brand-cyan bg-clip-text text-transparent">Member</span>?
          </h2>
          
          <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm">
            <form className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-brand-white font-medium mb-3">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  placeholder="Enter your email"
                  className="w-full px-4 py-3 rounded-lg bg-brand-navy/50 border border-brand-blue/20 text-brand-white placeholder-brand-cyan/50 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-all duration-300"
                  // TODO: Add email validation
                  // TODO: Connect to authentication system
                />
              </div>
              
              <div>
                <label htmlFor="password" className="block text-brand-white font-medium mb-3">
                  Password
                </label>
                <input
                  type="password"
                  id="password"
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 rounded-lg bg-brand-navy/50 border border-brand-blue/20 text-brand-white placeholder-brand-cyan/50 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent transition-all duration-300"
                  // TODO: Add password validation
                  // TODO: Implement secure authentication
                />
              </div>
              
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-brand-blue to-brand-cyan hover:from-brand-cyan hover:to-brand-blue text-brand-navy font-bold py-4 px-6 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg"
                // TODO: Add login form submission logic
                // TODO: Connect to user dashboard
              >
                Login to Your Dashboard
              </button>
            </form>
            
            <div className="mt-8 text-center space-y-3">
              <a href="#" className="block text-brand-blue hover:text-brand-cyan text-sm transition-colors duration-300">
                Forgot password?
              </a>
              <a href="#" className="block text-brand-blue hover:text-brand-cyan text-sm transition-colors duration-300">
                Create account
              </a>
            </div>
            
            {/* TODO: Add password reset functionality */}
            {/* TODO: Add user registration flow */}
            {/* TODO: Implement OAuth providers (Google, Facebook, etc.) */}
          </div>
        </div>
      </section>

      {/* 11. Footer Section */}
      <footer className="py-16 px-4 bg-gradient-to-b from-brand-navy/80 to-brand-navy/90 backdrop-blur-sm border-t border-brand-blue/10 relative z-10">
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
              <p className="text-brand-cyan text-lg leading-relaxed mb-6 max-w-md">
                Stop overpaying for power with our AI-powered energy plan optimization. 
                Smart algorithms find the perfect plan for your unique usage patterns.
              </p>
              <div className="flex space-x-4">
                <div className="w-10 h-10 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center hover:scale-110 transition-transform duration-300">
                  <svg className="w-5 h-5 text-brand-navy" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
                  </svg>
                </div>
                <div className="w-10 h-10 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center hover:scale-110 transition-transform duration-300">
                  <svg className="w-5 h-5 text-brand-navy" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/>
                  </svg>
                </div>
                <div className="w-10 h-10 bg-gradient-to-r from-brand-blue to-brand-cyan rounded-full flex items-center justify-center hover:scale-110 transition-transform duration-300">
                  <svg className="w-5 h-5 text-brand-navy" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Quick Links */}
            <div>
              <h3 className="text-brand-white font-semibold text-lg mb-6">Quick Links</h3>
              <div className="space-y-4">
                <a 
                  href="/privacy-policy" 
                  className="block text-brand-cyan hover:text-brand-blue transition-colors duration-300 cursor-pointer"
                  style={{ pointerEvents: 'auto', position: 'relative', zIndex: 1000 }}
                >
                  Privacy Policy
                </a>
                <a 
                  href="/terms" 
                  className="block text-brand-cyan hover:text-brand-blue transition-colors duration-300 cursor-pointer"
                  style={{ pointerEvents: 'auto', position: 'relative', zIndex: 1000 }}
                >
                  Terms of Service
                </a>
                <a 
                  href="/contact" 
                  className="block text-brand-cyan hover:text-brand-blue transition-colors duration-300 cursor-pointer"
                  style={{ pointerEvents: 'auto', position: 'relative', zIndex: 1000 }}
                >
                  Contact Us
                </a>
                <a 
                  href="/about" 
                  className="block text-brand-cyan hover:text-brand-blue transition-colors duration-300 cursor-pointer"
                  style={{ pointerEvents: 'auto', position: 'relative', zIndex: 1000 }}
                >
                  About IntelliWatt
                </a>
              </div>
            </div>

            {/* Support */}
            <div>
              <h3 className="text-brand-white font-semibold text-lg mb-6">Support</h3>
              <div className="space-y-4">
                <a href="#" className="block text-brand-cyan hover:text-brand-blue transition-colors duration-300">
                  Help Center
                </a>
                <a href="#" className="block text-brand-cyan hover:text-brand-blue transition-colors duration-300">
                  Energy Savings Guide
                </a>
                <a href="#" className="block text-brand-cyan hover:text-brand-blue transition-colors duration-300">
                  Smart Meter Setup
                </a>
                <a href="#" className="block text-brand-cyan hover:text-brand-blue transition-colors duration-300">
                  FAQ
                </a>
              </div>
            </div>
          </div>

          {/* Bottom Section */}
          <div className="border-t border-brand-blue/10 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center">
              <div className="mb-4 md:mb-0">
                <p className="text-brand-cyan text-sm">
                  An <span className="text-brand-blue font-semibold">IntelliPath Solutions</span> Company
                </p>
                <p className="text-brand-cyan text-sm">
                  IntelliWatt™ | A service of Intellipath Solutions LLC | © 2025 HitTheJackWatt™
                </p>
              </div>
              <div className="flex space-x-6">
                <a href="#" className="text-brand-cyan hover:text-brand-blue text-sm transition-colors duration-300">
                  Cookie Policy
                </a>
                <a href="#" className="text-brand-cyan hover:text-brand-blue text-sm transition-colors duration-300">
                  Accessibility
                </a>
                <a href="#" className="text-brand-cyan hover:text-brand-blue text-sm transition-colors duration-300">
                  Sitemap
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage; 