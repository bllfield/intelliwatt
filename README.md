# IntelliWatt™ Website

**Stop Overpaying for Power** - AI-powered energy optimization platform

## Project Docs
- **Authoritative Plan:** [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)
- **Environment Variables:** [`docs/ENV_VARS.md`](docs/ENV_VARS.md)

These two documents define the guardrails Cursor/GPT must follow and list required configuration for all environments.

## Overview

IntelliWatt™ is a comprehensive energy management platform that helps users optimize their electricity usage and find the best electricity plans using AI-powered insights. The platform integrates with smart meters, analyzes usage patterns, and provides personalized recommendations to reduce energy costs.

## Features

- 🏠 **Smart Meter Integration** - Real-time energy usage monitoring
- 📊 **Usage Analytics** - Detailed insights into energy consumption patterns
- 💡 **AI Recommendations** - Personalized suggestions for energy savings
- ⚡ **Plan Comparison** - Find the best electricity plans for your needs
- 📱 **Dashboard** - Comprehensive user dashboard for managing energy data
- 🔧 **Admin Panel** - Administrative tools for managing the platform

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS
- **Database**: Prisma ORM with SQLite (development)
- **Authentication**: Magic link authentication
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git

### Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/intelliwatt-website.git
cd intelliwatt-website
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

4. Set up the database:
```bash
npx prisma generate
npx prisma db push
```

5. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Project Structure

```
├── app/                    # Next.js App Router pages
│   ├── admin/             # Admin panel pages
│   ├── api/               # API routes
│   ├── dashboard/         # User dashboard
│   └── ...
├── components/            # React components
├── lib/                   # Utility libraries and business logic
├── prisma/               # Database schema and migrations
├── public/               # Static assets
└── tests/                # Test files
```

## API Endpoints

- `/api/quote` - Generate energy quotes
- `/api/offers` - Retrieve electricity plan offers
- `/api/rates` - Manage electricity rates
- `/api/admin/*` - Administrative functions

## Deployment

The application is configured for deployment on Vercel:

1. Connect your GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy automatically on every push to main branch

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

IntelliPath Solutions
- Website: [IntelliWatt™](https://intelliwatt.com)
- Email: support@intelliwatt.com

---

**IntelliWatt™** - HitTheJackWatt™
