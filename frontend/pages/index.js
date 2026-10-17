import Head from "next/head";
import Link from "next/link";
import styles from "@/styles/Home.module.css";

export default function Home() {
  return (
    <>
      <Head>
        <title>PT Form Coach | Real time form correction in your browser</title>
        <meta
          name="description"
          content="Your PT prescribes the exercise. Our app watches you at home and corrects you in real time: free, in your browser, in your language."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className={styles.page}>
        <section className={styles.hero}>
          <h1 className={styles.brand}>PT Form Coach</h1>
          <p className={styles.headline}>
            Your PT prescribes the exercise. We correct you in real time at home, in your
            browser.
          </p>
          <p className={styles.sub}>
            No app install. No employer plan. Your personal movement baseline, not a textbook
            body. Video never leaves your device.
          </p>

          <div className={styles.ctaRow}>
            <Link href="/session" className={styles.cta}>
              Start squat session
            </Link>
            <Link href="/dashboard" className={`${styles.cta} ${styles.ctaSecondary}`}>
              PT dashboard
            </Link>
          </div>

          <ul className={styles.points}>
            <li>On device MediaPipe pose: works even if the network drops</li>
            <li>Calibrates to your body in 3 warm up reps</li>
            <li>English and Spanish voice cues</li>
            <li>Keypoints logged to OCI, never video</li>
          </ul>
        </section>

        <footer className={styles.footer}>
          HackTN 2026 · Health Access, Equity and Experience · Built with OCI and MediaPipe
        </footer>
      </main>
    </>
  );
}
