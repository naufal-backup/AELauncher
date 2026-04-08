# AELauncher

A modern, high-performance **Arknights: Endfield Launcher** built with **Electron**, **React**, and **Vite**. AELauncher provides a seamless experience for managing and launching Arknights: Endfield on Linux.

![Build and Release](https://github.com/naufal-backup/AELauncher/actions/workflows/build.yml/badge.svg)

## 🚀 Features

- **Arknights: Endfield Optimized**: Specifically designed for a smooth Arknights: Endfield experience on Linux.
- **Blazing Fast**: Powered by Vite for near-instant development and optimized production builds.
- **Modern UI**: Styled with Tailwind CSS and smooth animations using Framer Motion.
- **Multi-Format Linux Support**: Automatically packaged as AppImage, DEB, and Pacman.
- **Automated CI/CD**: Seamlessly built and released via GitHub Actions.

## 📦 Installation

You can download the latest version from the [Releases](https://github.com/naufal-backup/AELauncher/releases) page.

### 1. AppImage (Universal Linux)
1. Download the `.AppImage` file.
2. Right-click the file -> Properties -> Permissions -> **Allow executing file as program**.
3. Double-click to run.

### 2. Debian/Ubuntu (.deb)
```bash
sudo dpkg -i aelauncher_0.1.0_amd64.deb
sudo apt-get install -f # Install missing dependencies if any
```

### 3. Arch Linux (.pacman)
```bash
sudo pacman -U aelauncher-0.1.0.pacman
```

## 🛠️ Development

### Prerequisites
- Node.js (v18 or higher)
- npm

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/naufal-backup/AELauncher.git
   cd AELauncher
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Scripts
- `npm run dev`: Start Vite and Electron in development mode with Hot Module Replacement (HMR).
- `npm run build`: Build the frontend and package the application for Linux.
- `npm run preview`: Preview the production build of the frontend.

## 🤖 Automated Release Workflow

This project uses GitHub Actions to automate the build process. To trigger a new release:

1. Update the version in `package.json`.
2. Commit and push your changes to `main`.
3. Create and push a new tag:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
The workflow will automatically build the `AppImage`, `.deb`, and `.pacman` packages and upload them to a new GitHub Release.

## 📄 License
This project is private. See [package.json](package.json) for more details.
