REVOMAKER SYSTEM SHARE - simple version

FILES
  index.html      the page a person sees when you send them a share link (only that one file)
  dashboard.html  owner login + dashboard
  style.css       all the styling
  bg.mp4          background video (replace with any mp4, same name)
  api/index.js    the backend (login + saving files)

SHARING
  In the dashboard press Share on a file, send the copied link. That person sees ONLY that file.
  Stop sharing makes the old link stop working. Files are private until you share them.

LOGIN
  username: revomakeadmin
  password: secret1
  (change them any time: Vercel > Settings > Environment Variables > OWNER_USERNAME and OWNER_PASSWORD, then Redeploy)

PUT ON VERCEL (free Hobby plan is enough)
  1. Upload this folder to a PRIVATE GitHub repo, then Vercel > Add New > Project > import it. Leave build settings empty.
  2. In the project open Storage (or Marketplace) > add "Upstash Redis" (free) > connect to the project.
  3. Deployments > Redeploy.
  4. Open your vercel.app link. Owner page: your-link/dashboard.html
