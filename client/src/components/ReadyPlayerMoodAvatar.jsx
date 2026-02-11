import { useEffect, useMemo, useRef, useState } from 'react';

const LOTTIE_PLAYER_SCRIPT_ID = 'lottie-player-script';
const LOTTIE_PLAYER_SCRIPT_URL =
  'https://unpkg.com/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js';

const MOOD_ANIMATION_URLS = {
  happy: 'https://assets-v2.lottiefiles.com/a/d142f874-8f36-11ee-9184-5f2bc120fe78/GMOKzbaHCf.json',
  neutral: 'https://assets-v2.lottiefiles.com/a/ece297e4-ec63-11ee-8260-0b4c130b5228/sFG8oVRdsH.json',
  sad: 'https://assets-v2.lottiefiles.com/a/8a5d6192-8f36-11ee-9481-3f2e4a675642/MSoiESgVuw.json',
};

function resolveMoodTone(moodLabel) {
  if (moodLabel === 'great' || moodLabel === 'good') {
    return 'happy';
  }
  if (moodLabel === 'low' || moodLabel === 'tough') {
    return 'sad';
  }
  return 'neutral';
}

function isLikelyAnimationUrl(value) {
  const url = String(value || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return false;
  }
  return /\.(json|lottie)(\?.*)?$/i.test(url) || url.includes('assets-v2.lottiefiles.com/');
}

function getMoodEmoji(tone) {
  if (tone === 'happy') {
    return ':)';
  }
  if (tone === 'sad') {
    return ':(';
  }
  return ':|';
}

function getSpeedByTone(tone) {
  if (tone === 'happy') {
    return 1.1;
  }
  if (tone === 'sad') {
    return 0.85;
  }
  return 1;
}

function ReadyPlayerMoodAvatar({ moodLabel = 'neutral', compact = false, avatarModelUrl = '' }) {
  const [pluginReady, setPluginReady] = useState(false);
  const [pluginError, setPluginError] = useState('');
  const playerRef = useRef(null);
  const isReady = pluginReady || Boolean(window.customElements?.get('lottie-player'));

  const tone = useMemo(() => resolveMoodTone(moodLabel), [moodLabel]);
  const animationUrl = useMemo(() => {
    const custom = String(avatarModelUrl || '').trim();
    if (isLikelyAnimationUrl(custom)) {
      return custom;
    }
    return MOOD_ANIMATION_URLS[tone] || MOOD_ANIMATION_URLS.neutral;
  }, [avatarModelUrl, tone]);
  const playerKey = `${tone}-${animationUrl}`;

  useEffect(() => {
    if (window.customElements?.get('lottie-player')) {
      return undefined;
    }

    const existingScript = document.getElementById(LOTTIE_PLAYER_SCRIPT_ID);
    const script = existingScript || document.createElement('script');
    let cancelled = false;

    const handleLoad = () => {
      if (cancelled) {
        return;
      }
      setPluginReady(true);
      setPluginError('');
    };

    const handleError = () => {
      if (cancelled) {
        return;
      }
      setPluginError('Cannot load online avatar plugin right now.');
    };

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);

    if (!existingScript) {
      script.id = LOTTIE_PLAYER_SCRIPT_ID;
      script.src = LOTTIE_PLAYER_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const player = playerRef.current;
    if (!player || typeof player.stop !== 'function' || typeof player.play !== 'function') {
      return;
    }
    try {
      // Restart animation when mood/source changes.
      player.stop();
      player.play();
    } catch {
      // Ignore custom element timing errors.
    }
  }, [animationUrl, isReady]);

  return (
    <figure className={`rpm-avatar ${compact ? 'compact' : ''}`}>
      <div className={`rpm-avatar-canvas mood-tone-${tone}`} role="img" aria-label="Mood avatar animation">
        {isReady ? (
          <lottie-player
            key={playerKey}
            ref={playerRef}
            src={animationUrl}
            background="transparent"
            speed={getSpeedByTone(tone)}
            style={{ width: '100%', height: '100%' }}
            autoplay
            loop
            mode="normal"
            renderer="svg"
          />
        ) : (
          <div className="rpm-avatar-fallback">{getMoodEmoji(tone)}</div>
        )}
      </div>

      {!isReady && !pluginError && <p className="rpm-avatar-note">Loading mood animation...</p>}

      {pluginError && <p className="rpm-avatar-error">{pluginError}</p>}
    </figure>
  );
}

export default ReadyPlayerMoodAvatar;
