/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

// Custom useTypewriter hook
function useTypewriter(text: string, speed = 38, startDelay = 600) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    timer = setTimeout(() => {
      interval = setInterval(() => {
        index += 1;
        setDisplayed(text.slice(0, index));
        if (index >= text.length) {
          if (interval) clearInterval(interval);
          setDone(true);
        }
      }, speed);
    }, startDelay);

    return () => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [text, speed, startDelay]);

  return { displayed, done };
}

const DB_NAME = 'mainframe_media';
const STORE_NAME = 'videos';
const KEY = 'aria_background';

function saveVideoToIDB(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(blob, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

function loadVideoFromIDB(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(STORE_NAME, 'readonly');
        const getReq = tx.objectStore(STORE_NAME).get(KEY);
        getReq.onsuccess = () => {
          if (getReq.result instanceof Blob) {
            resolve(URL.createObjectURL(getReq.result));
          } else {
            resolve(null);
          }
        };
        getReq.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const targetTimeRef = useRef<number>(0);
  const isSeekingRef = useRef<boolean>(false);
  const prevXRef = useRef<number | null>(null);

  // Video source: checks IndexedDB first, then /aria.mp4, and falls back to default
  const [videoSource, setVideoSource] = useState<string>('/aria.mp4');
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [buttonsVisible, setButtonsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // Load persisted video from IndexedDB if the user previously dropped one
  useEffect(() => {
    loadVideoFromIDB().then((cachedUrl) => {
      if (cachedUrl) {
        setVideoSource(cachedUrl);
      }
    });
  }, []);

  // Allow dragging and dropping the video file directly onto the browser preview
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingVideo(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDraggingVideo(false);
      }
    };
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingVideo(false);
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('video/')) {
          await handleFileSelect(file);
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // Typewriter text
  const typewriterText = "Glad you stopped in. Good taste tends to find us. Now, what are we building?";
  const { displayed, done } = useTypewriter(typewriterText, 38, 600);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleFileSelect = async (file: File) => {
    if (file && (file.type.startsWith('video/') || file.name.endsWith('.mp4'))) {
      await saveVideoToIDB(file).catch(() => {});
      const blobUrl = URL.createObjectURL(file);
      setVideoSource(blobUrl);
      targetTimeRef.current = 0;
      isSeekingRef.current = false;

      // Automatically persist to project files (public/aria.mp4) so it is bundled for deployment
      try {
        setSaveStatus('saving');
        const res = await fetch('/api/save-video', {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'video/mp4',
          },
          body: file,
        });
        if (res.ok) {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 5000);
        } else {
          setSaveStatus('error');
        }
      } catch (err) {
        console.error('Error saving video to project files:', err);
        setSaveStatus('error');
      }
    }
  };

  // Action pill buttons become visible 400ms after page load
  useEffect(() => {
    const timer = setTimeout(() => {
      setButtonsVisible(true);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  // Video seeking logic
  const attemptSeek = useCallback(() => {
    const video = videoRef.current;
    if (!video || isSeekingRef.current) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;

    const target = targetTimeRef.current;
    if (Math.abs(video.currentTime - target) > 0.005) {
      isSeekingRef.current = true;
      video.currentTime = target;
    }
  }, []);

  const handleSeeked = useCallback(() => {
    isSeekingRef.current = false;
    attemptSeek();
  }, [attemptSeek]);

  // Mouse scrub handler
  useEffect(() => {
    const SENSITIVITY = 0.8;

    const handleMouseMove = (e: MouseEvent) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
        prevXRef.current = e.clientX;
        return;
      }

      if (prevXRef.current === null) {
        prevXRef.current = e.clientX;
        return;
      }

      const delta = e.clientX - prevXRef.current;
      prevXRef.current = e.clientX;

      const duration = video.duration;
      const timeOffset = (delta / window.innerWidth) * SENSITIVITY * duration;
      targetTimeRef.current = Math.min(
        Math.max(targetTimeRef.current + timeOffset, 0),
        duration
      );

      attemptSeek();
    };

    const handleMouseLeave = () => {
      prevXRef.current = null;
    };

    // Touch scrub support for mobile devices
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        prevXRef.current = e.touches[0].clientX;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || e.touches.length === 0) {
        return;
      }
      const clientX = e.touches[0].clientX;
      if (prevXRef.current === null) {
        prevXRef.current = clientX;
        return;
      }
      const delta = clientX - prevXRef.current;
      prevXRef.current = clientX;

      const duration = video.duration;
      const timeOffset = (delta / window.innerWidth) * SENSITIVITY * duration;
      targetTimeRef.current = Math.min(
        Math.max(targetTimeRef.current + timeOffset, 0),
        duration
      );

      attemptSeek();
    };

    const handleTouchEnd = () => {
      prevXRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [attemptSeek]);

  // Copy email handler
  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText('shahanvi2302@gmail.com');
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for clipboard write if not supported
      const textArea = document.createElement('textarea');
      textArea.value = 'shahanvi2302@gmail.com';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const navLinks = [
    { label: 'Labs', href: '#labs' },
    { label: 'Studio', href: '#studio' },
    { label: 'Openings', href: '#openings' },
    { label: 'Shop', href: '#shop' },
  ];

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none">
      {/* Subtle Drag-and-Drop overlay indication */}
      {isDraggingVideo && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center pointer-events-none transition-all">
          <div className="bg-white text-black px-6 py-4 rounded-2xl shadow-2xl border border-black/10 flex items-center gap-3">
            <span className="text-xl">✳︎</span>
            <span className="text-base font-medium">Drop video here to update A.R.I.A</span>
          </div>
        </div>
      )}

      {/* Deployment Persistence Toast */}
      {saveStatus !== 'idle' && (
        <div className="fixed bottom-6 right-6 z-50 pointer-events-auto transition-all animate-bounce">
          <div className="bg-black/90 backdrop-blur-md text-white text-xs sm:text-sm px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-white/10">
            {saveStatus === 'saving' && (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Saving aria.mp4 to project files for deployment...</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <span className="text-emerald-400 font-bold">✓</span>
                <span>aria.mp4 permanently saved to project. Ready to deploy!</span>
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <span className="text-amber-400">ℹ︎</span>
                <span>Loaded in preview. Drop into project public/ folder to commit.</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* BACKGROUND VIDEO (mouse-scrub controlled) */}
      <video
        ref={videoRef}
        key={videoSource}
        src={videoSource}
        muted
        playsInline
        preload="auto"
        onError={() => {
          if (videoSource === '/aria.mp4') {
            setVideoSource(
              'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260530_042513_df96a13b-6155-4f6e-8b93-c9dee66fba08.mp4'
            );
          }
        }}
        onSeeked={handleSeeked}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            targetTimeRef.current = videoRef.current.currentTime || 0;
          }
        }}
        className="fixed inset-0 z-0 w-full h-full object-cover pointer-events-none"
        style={{
          objectPosition: '70% center',
        }}
      />

      {/* Hidden file input for picking aria.mp4 directly */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleFileSelect(file);
          }
        }}
      />

      {/* NAVBAR (fixed, z-index: 10) */}
      <nav className="fixed top-0 left-0 right-0 z-10 w-full px-5 sm:px-8 py-4 sm:py-5 flex justify-between items-center">
        {/* Logo (left) */}
        <div className="flex items-center gap-3 group text-black">
          <a
            href="/"
            className="text-[21px] sm:text-[26px] tracking-tight leading-none text-black focus:outline-none"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Mainframe®
          </a>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Click to select aria video file from your computer"
            aria-label="Upload video file"
            className="text-[25px] sm:text-[30px] leading-none select-none text-black transition-transform duration-300 group-hover:rotate-45 cursor-pointer bg-transparent border-none p-0 focus:outline-none"
            style={{ letterSpacing: '-0.02em' }}
          >
            ✳︎
          </button>
        </div>

        {/* Desktop nav links (center, hidden below md) */}
        <div className="hidden md:flex items-center text-[23px] text-black">
          {navLinks.map((link, idx) => (
            <React.Fragment key={link.label}>
              <a
                href={link.href}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveModal(link.label);
                }}
                className="hover:opacity-60 transition-opacity"
              >
                {link.label}
              </a>
              {idx < navLinks.length - 1 && <span>,&nbsp;</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Desktop CTA (right, hidden below md) */}
        <div className="hidden md:block">
          <a
            href="mailto:shahanvi2302@gmail.com"
            className="text-[23px] text-black underline underline-offset-2 hover:opacity-60 transition-opacity"
          >
            Get in touch
          </a>
        </div>

        {/* Mobile hamburger (visible below md) */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
          className="md:hidden flex flex-col justify-center items-center gap-[5px] w-8 h-8 focus:outline-none relative z-20 cursor-pointer"
        >
          <span
            className={`w-6 h-[2px] bg-black transition-all duration-300 origin-center ${
              mobileMenuOpen ? 'rotate-45 translate-y-[7px]' : ''
            }`}
          />
          <span
            className={`w-6 h-[2px] bg-black transition-opacity duration-300 ${
              mobileMenuOpen ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <span
            className={`w-6 h-[2px] bg-black transition-all duration-300 origin-center ${
              mobileMenuOpen ? '-rotate-45 -translate-y-[7px]' : ''
            }`}
          />
        </button>
      </nav>

      {/* Mobile overlay (z-index: 9) */}
      <div
        className={`fixed inset-0 z-[9] bg-white/95 backdrop-blur-sm flex flex-col justify-center items-start px-8 gap-8 transition-opacity duration-300 md:hidden ${
          mobileMenuOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
      >
        {navLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            onClick={(e) => {
              e.preventDefault();
              setMobileMenuOpen(false);
              setActiveModal(link.label);
            }}
            className="text-[32px] font-medium text-black hover:opacity-60 transition-opacity"
          >
            {link.label}
          </a>
        ))}
        <a
          href="mailto:shahanvi2302@gmail.com"
          onClick={() => setMobileMenuOpen(false)}
          className="text-[32px] font-medium text-black underline underline-offset-2 hover:opacity-60 transition-opacity"
        >
          Get in touch
        </a>
      </div>

      {/* HERO SECTION (z-index: 1) */}
      <main className="relative z-1 w-full h-screen flex flex-col justify-end pb-12 md:justify-center md:pb-0 px-5 sm:px-8 md:px-10 overflow-hidden">
        {/* Content container: max-w-xl, relative z-10 */}
        <div className="max-w-xl relative z-10">
          {/* 1. Blurred intro label */}
          <div
            className="pointer-events-none select-none mb-5 sm:mb-6"
            style={{
              fontSize: 'clamp(18px, 4vw, 26px)',
              lineHeight: 1.3,
              fontWeight: 400,
              color: '#000',
              filter: 'blur(4px)',
            }}
            aria-hidden="true"
          >
            Hey there, meet A.R.I.A,
            <br />
            Mainframe&apos;s Adaptive Response Interface Agent
          </div>

          {/* 2. Typewriter text */}
          <p
            className="text-black mb-5 sm:mb-6"
            style={{
              fontSize: 'clamp(18px, 4vw, 26px)',
              lineHeight: 1.35,
              fontWeight: 400,
              minHeight: '54px',
            }}
          >
            {displayed}
            {!done && (
              <span
                className="inline-block w-[2px] h-[1.1em] bg-black align-middle ml-[2px] animate-cursor-blink"
                aria-hidden="true"
              />
            )}
          </p>

          {/* 3. Action pill buttons */}
          <div
            className={`flex flex-wrap gap-y-1 transition-all duration-400 ease-out ${
              buttonsVisible
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-[8px]'
            }`}
            style={{
              transition: 'opacity 0.4s ease, transform 0.4s ease',
            }}
          >
            {/* 4 white pill buttons */}
            <button
              type="button"
              onClick={() => setActiveModal('pitch')}
              className="inline-flex items-center justify-center bg-white text-black border border-black/10 rounded-full text-[13px] sm:text-[15px] px-4 sm:px-5 py-[0.3em] mx-[0.2em] mb-[0.4em] whitespace-nowrap hover:bg-black hover:text-white transition-colors duration-200 cursor-pointer shadow-sm active:scale-95"
            >
              Pitch us an idea
            </button>

            <button
              type="button"
              onClick={() => setActiveModal('careers')}
              className="inline-flex items-center justify-center bg-white text-black border border-black/10 rounded-full text-[13px] sm:text-[15px] px-4 sm:px-5 py-[0.3em] mx-[0.2em] mb-[0.4em] whitespace-nowrap hover:bg-black hover:text-white transition-colors duration-200 cursor-pointer shadow-sm active:scale-95"
            >
              Come work here
            </button>

            <button
              type="button"
              onClick={() => setActiveModal('hello')}
              className="inline-flex items-center justify-center bg-white text-black border border-black/10 rounded-full text-[13px] sm:text-[15px] px-4 sm:px-5 py-[0.3em] mx-[0.2em] mb-[0.4em] whitespace-nowrap hover:bg-black hover:text-white transition-colors duration-200 cursor-pointer shadow-sm active:scale-95"
            >
              Send a brief hello
            </button>

            <button
              type="button"
              onClick={() => setActiveModal('operate')}
              className="inline-flex items-center justify-center bg-white text-black border border-black/10 rounded-full text-[13px] sm:text-[15px] px-4 sm:px-5 py-[0.3em] mx-[0.2em] mb-[0.4em] whitespace-nowrap hover:bg-black hover:text-white transition-colors duration-200 cursor-pointer shadow-sm active:scale-95"
            >
              See how we operate
            </button>

            {/* 1 outline pill button */}
            <button
              type="button"
              onClick={handleCopyEmail}
              className="relative group inline-flex items-center justify-center text-white bg-transparent border border-white rounded-full text-[13px] sm:text-[15px] px-4 sm:px-5 py-[0.3em] mx-[0.2em] mb-[0.4em] whitespace-nowrap gap-2 sm:gap-3 hover:bg-white hover:text-black transition-colors duration-200 cursor-pointer active:scale-95"
              title="Click to copy email address"
            >
              <span>
                Reach us:{' '}
                <span className="underline underline-offset-1">
                  {copied ? 'copied to clipboard!' : 'shahanvi2302@gmail.com'}
                </span>
              </span>
              {/* 12x12 copy icon (two overlapping rectangles) */}
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="shrink-0"
              >
                <rect
                  x="3.5"
                  y="1.5"
                  width="7"
                  height="7"
                  rx="1"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <rect
                  x="1.5"
                  y="3.5"
                  width="7"
                  height="7"
                  rx="1"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </button>
          </div>
        </div>
      </main>

      {/* Interactive Modal Dialog for pill button & nav link clicks */}
      {activeModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="bg-white text-black rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="absolute top-5 right-5 text-gray-500 hover:text-black text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
              aria-label="Close dialog"
            >
              ✕
            </button>

            {activeModal === 'pitch' && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">✳︎</span>
                  <h3
                    className="text-2xl font-bold tracking-tight"
                    style={{ fontFamily: 'var(--font-heading)' }}
                  >
                    Pitch Us An Idea
                  </h3>
                </div>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  We partner with audacious founders, product teams, and cultural institutions to shape identity, digital systems, and cinematic interactions.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href="mailto:shahanvi2302@gmail.com?subject=Project%20Inquiry%20%E2%80%94%20Mainframe"
                    className="inline-flex items-center justify-center bg-black text-white px-5 py-3 rounded-full text-sm font-medium hover:bg-black/80 transition-colors"
                  >
                    Email shahanvi2302@gmail.com
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('shahanvi2302@gmail.com');
                      setActiveModal(null);
                    }}
                    className="inline-flex items-center justify-center border border-black/20 text-black px-5 py-3 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    Copy Address
                  </button>
                </div>
              </div>
            )}

            {activeModal === 'careers' && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">✳︎</span>
                  <h3
                    className="text-2xl font-bold tracking-tight"
                    style={{ fontFamily: 'var(--font-heading)' }}
                  >
                    Work With Mainframe
                  </h3>
                </div>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  We are always scouting for senior creative technologists, kinetic designers, and systems architects who push the boundaries of digital craft.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href="mailto:shahanvi2302@gmail.com?subject=Creative%20Role%20Inquiry"
                    className="inline-flex items-center justify-center bg-black text-white px-5 py-3 rounded-full text-sm font-medium hover:bg-black/80 transition-colors"
                  >
                    Send Portfolio to shahanvi2302@gmail.com
                  </a>
                </div>
              </div>
            )}

            {activeModal === 'hello' && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">✳︎</span>
                  <h3
                    className="text-2xl font-bold tracking-tight"
                    style={{ fontFamily: 'var(--font-heading)' }}
                  >
                    Say Hello
                  </h3>
                </div>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  Drop a line, request a private case study deck, or set up a studio visit in our workshop spaces.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href="mailto:shahanvi2302@gmail.com"
                    className="inline-flex items-center justify-center bg-black text-white px-5 py-3 rounded-full text-sm font-medium hover:bg-black/80 transition-colors"
                  >
                    Open Mail Client
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('shahanvi2302@gmail.com');
                      setActiveModal(null);
                    }}
                    className="inline-flex items-center justify-center border border-black/20 text-black px-5 py-3 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    Copy shahanvi2302@gmail.com
                  </button>
                </div>
              </div>
            )}

            {activeModal === 'operate' && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">✳︎</span>
                  <h3
                    className="text-2xl font-bold tracking-tight"
                    style={{ fontFamily: 'var(--font-heading)' }}
                  >
                    Operating Principles
                  </h3>
                </div>
                <p className="text-gray-600 mb-4 leading-relaxed">
                  1. High-frequency prototyping over static decks.<br />
                  2. Kinetic feedback loops built directly in production code.<br />
                  3. Precision typography and tactile motion as brand identity.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="w-full mt-4 bg-black text-white py-3 rounded-full text-sm font-medium hover:bg-black/80 transition-colors"
                >
                  Understood
                </button>
              </div>
            )}

            {['Labs', 'Studio', 'Openings', 'Shop'].includes(activeModal) && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">✳︎</span>
                  <h3
                    className="text-2xl font-bold tracking-tight"
                    style={{ fontFamily: 'var(--font-heading)' }}
                  >
                    Mainframe {activeModal}
                  </h3>
                </div>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  {activeModal === 'Labs' && 'Experimental software research, computational aesthetics, and real-time interaction frameworks.'}
                  {activeModal === 'Studio' && 'Bespoke identity design, high-fidelity web experiences, and physical computing installations.'}
                  {activeModal === 'Openings' && 'Current open opportunities across interaction design, creative engineering, and art direction.'}
                  {activeModal === 'Shop' && 'Limited edition studio monographs, generative prints, and bespoke industrial artifacts.'}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="w-full bg-black text-white py-3 rounded-full text-sm font-medium hover:bg-black/80 transition-colors"
                >
                  Back to experience
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
