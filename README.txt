REVOMAKER SYSTEM SHARE - simple version

FILES
  index.html      public page (everyone sees the text files)
  dashboard.html  owner login + dashboard
  style.css       all the styling
  bg.mp4          background video (replace with any mp4, same name)
  api/index.js    the backend (login + saving files)

LOGIN
  username: revomakeadmin
  password: secret1
  (change them any time: Vercel > Settings > Environment Variables > OWNER_USERNAME and OWNER_PASSWORD, then Redeploy)

PUT ON VERCEL (free Hobby plan is enough)
  1. Upload this folder to a PRIVATE GitHub repo, then Vercel > Add New > Project > import it. Leave build settings empty.
  2. In the project open Storage (or Marketplace) > add "Upstash Redis" (free) > connect to the project.
  3. Deployments > Redeploy.
  4. Open your vercel.app link. Owner page: your-link/dashboard.html
