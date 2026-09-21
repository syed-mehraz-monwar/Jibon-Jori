# JibonJori – AI Assisted Matrimony Platform

## Tools and Technologies

The following technologies are planned for the JibonJori project. Use these as the baseline technology stack unless a later project decision explicitly changes them.

### Frontend
- React.js
- Tailwind CSS
- Sass
- GSAP for animations and interactive UI effects

### Backend
- Node.js
- Express.js

### Database
- PostgreSQL

### APIs
- REST API
- GraphQL API

### Authentication and Security
- Email verification using OTP
- Phone number verification using OTP
- Secure user session management
- Secure logout
- Authentication and authorization for protected features

### Artificial Intelligence / Machine Learning
- LLM API for the AI chatbot and intelligent matchmaking assistance
- TensorFlow Lite or another suitable on-device ML solution for real-time compatibility prediction
- AI-powered compatibility scoring
- Personalized matchmaking recommendations

### Storage
- Firebase Storage for profile images and uploaded files

### Maps and Location
- Google Maps API
- Real-time/user location features
- Location-based matchmaking

### Media
- YouTube API and/or embedded YouTube videos for relationship and marriage-related content

### Reporting
- Crystal Reports for generating user, profile, matchmaking, and administrative reports

### Containerization and Deployment
- Docker

### Version Control
- Git
- GitHub

---

# Important and Interesting Features

## 1. AI-Powered Matchmaking
- AI-based partner compatibility prediction.
- Generate a compatibility score between users based on profile information, preferences, interests, location, education, profession, and other relevant factors.
- Provide personalized partner/match recommendations.
- Explain the major reasons behind a compatibility score.
- Allow users to discover recommended profiles through an AI-assisted matching system.

## 2. AI Chatbot
- Provide an AI chatbot for users.
- Help users create and improve their matrimonial profiles.
- Help users define partner preferences.
- Answer general questions about using the platform.
- Provide matchmaking suggestions based on available profile information.

## 3. User Registration and Authentication
- User registration using email and/or phone number.
- Email OTP verification.
- Phone OTP verification.
- Secure login and logout.
- Session management.
- Protected routes/pages for authenticated users.

## 4. Real-Time Username Verification
- Check username availability against the database while the user is typing.
- Display availability status without refreshing or reloading the page.

## 5. Detailed Matrimonial Profiles
- Create detailed user profiles.
- Multiple text input fields.
- Multiple dropdown/select fields.
- Date picker for date of birth and other relevant dates.
- Profile photo upload.
- Education, profession, location, interests, lifestyle, and other matrimonial information.
- Partner preference information.

## 6. Real-Time Comments
- Users can comment on appropriate profiles/content.
- Comments should appear in real time without requiring a page refresh.
- Store comments in the application's database.

## 7. Like / Dislike / Favorite
- Like profiles.
- Dislike profiles.
- Add profiles to favorites.
- Update interaction results without a full page reload.
- Store user interactions in the database.

## 8. Profile Rating
- Allow users to provide ratings where appropriate.
- Store ratings in the database.
- Display calculated ratings/statistics.

## 9. Advanced Search and Filtering
- Search for potential partners using multiple criteria.
- Filter by age.
- Filter by gender.
- Filter by location.
- Filter by education.
- Filter by profession.
- Filter by interests.
- Filter by other matrimonial preferences.
- Combine multiple filters.

## 10. Pagination
- Paginate large collections of user profiles and search results.
- Avoid loading every profile at once.
- Provide a smooth browsing experience.

## 11. Google Maps and Location Features
- Integrate Google Maps.
- Display user/location information where appropriate.
- Support location-based matching or discovery.
- Use location information as one factor in matchmaking.

## 12. Image and File Upload
- Allow users to upload profile images.
- Allow appropriate supporting document/file uploads if required.
- Store uploaded files using Firebase Storage.
- Store file metadata and references in PostgreSQL.
- Provide appropriate file validation and access control.

## 13. Date Picker
- Use date pickers for date of birth and other relevant dates.
- Validate date input appropriately.

## 14. Embedded Audio/Video
- Embed relationship, marriage, or educational videos using YouTube.
- Allow users to watch relevant media without leaving the application where possible.

## 15. AI Compatibility Score
- Calculate and display a compatibility percentage.
- Example:
  - Overall Compatibility: 87%
  - Personality: 92%
  - Interests: 90%
  - Education: 85%
  - Location: 80%
- The exact scoring model can evolve during implementation.
- AI/ML should be used where appropriate rather than using only hard-coded scores.

## 16. Animated and Responsive UI
- Use GSAP for meaningful animations and interactions.
- Use Tailwind CSS and Sass for styling.
- Build a responsive interface for desktop, tablet, and mobile.
- Maintain a clean, modern matrimony-focused visual design.

## 17. REST API
- Implement RESTful backend endpoints for core application operations.
- Support CRUD operations where appropriate.
- Use proper validation and error handling.

## 18. GraphQL API
- Implement GraphQL for selected data/query operations.
- Use GraphQL alongside the REST API where it provides value.

## 19. Crystal Reports
- Generate reports for relevant application data.
- Possible reports include:
  - User/profile reports
  - Matchmaking reports
  - Compatibility reports
  - Ratings/interaction reports
  - Administrative reports

## 20. Docker
- Containerize the application using Docker.
- Provide a reproducible development/deployment environment.
- Separate application services where appropriate.

## 21. Git and GitHub
- Use Git for version control.
- Use GitHub for repository hosting.
- Maintain meaningful commits.
- Use branches appropriately for major features.
- Keep the project README and documentation updated.

---

# Core Project Goal

JibonJori should be more than a basic matrimony website. The main goal is to build a modern, AI-assisted matrimony platform where users can:

1. Create and verify their matrimonial profile.
2. Search and filter potential partners.
3. Like, dislike, favorite, comment on, and rate profiles where appropriate.
4. View location-related information through Google Maps.
5. Receive AI-powered partner recommendations.
6. See an AI-generated compatibility score.
7. Interact with an AI chatbot for profile and matchmaking assistance.
8. Upload profile images/files using cloud storage.
9. Use a responsive and animated modern interface.
10. Generate relevant reports.

## Course Requirement Coverage

The implementation should intentionally cover the required course technologies/features, including:

- Real-time database interaction
- Real-time commenting
- Like/dislike functionality
- Real-time username verification
- Email/phone verification
- Multiple textboxes and dropdowns
- Rating system
- Pagination
- Embedded audio/video
- Google Maps
- Session management
- TensorFlow Lite/on-device ML
- Image/file upload and cloud storage
- Date picker
- GSAP/Framer Motion animations
- Sass/Tailwind CSS
- Git/GitHub
- GraphQL
- REST API
- Crystal Reports
- Modern frontend framework
- Docker
- Generative AI/LLM integration
- Additional task-specific AI matchmaking features
