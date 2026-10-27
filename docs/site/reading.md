# Reading documentation

## Signing in

docs.umccr.org uses the same sign-in as the UMCCR portal: your UMCCR Google Workspace account, through the UMCCR
Cognito user pool. Opening any page without a session takes you to the sign-in page; after signing in you return to
the page you asked for.

The first time, you choose **Sign in with UMCCR account** and go through Google. After that, sign-in is renewed
automatically when you come back, for as long as your session with Cognito lasts (up to 30 days), and you see a
brief "Checking sign-in…" page at most.

Every page requires sign-in, including the catalogue. All signed-in UMCCR readers can read every site.

## Signing out

Use **Sign out** in the account menu (your initials, top right). This ends your docs session, signs you out of
Cognito and revokes your refresh token. It does not sign you out of Google.

## Asking the docs

The **Ask the docs** button, bottom right on every page, opens a chat panel provided by OrcaSonar, UMCCR's
documentation search and answer service; so do ⌘K on a Mac and Ctrl+K elsewhere. The search box at the top offers
the same: above its results, ask the docs what you searched for; below them, search every site.

- **Ask** answers a question from UMCCR documentation and lists the pages it used; check the sources, because
  answers can be wrong. A number in brackets, such as [2], is the source with that number and links to its page.
  Follow-up questions keep the conversation's context.
- **Search** lists the best-matching passages, with links, without writing an answer.
- **This site only** limits both to the site you are reading; clear it to search every site.
- **+** starts a new conversation.

Each reader has a daily allowance of answers, and the team shares a monthly budget. When either runs out, the panel
says when to try again; Search usually keeps working.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "Sign-in is temporarily unavailable" | Try again in a few minutes; report it if it persists. |
| "Signing in keeps repeating" | Your browser may be blocking cookies for docs.umccr.org; allow them, wait a minute and choose **Sign in with UMCCR account**. |
| The sign-in button, although you signed in before | Your Cognito session has ended or your account was disabled. Sign in again; contact the platform team if it fails. |
| "Page not found" | The page may have moved. Start from the [catalogue](index.md). |
| The chat panel says your sign-in has expired | Follow **Sign in again**; you return to the same page. |
| The chat panel says chat is unavailable | Try again in a few minutes; report it if it persists. |
| The chat panel says an answer stalled, or a search took too long | Ask again; report it if it keeps happening. |

## Privacy

The docs site keeps a session cookie that identifies your Cognito account, not your email address. Access logs
record the pages requested and are kept for 90 days.

Questions asked in the chat panel, with their answers, sources and your Cognito account ID, are kept for 30 days to
improve answers, and then deleted. A few examples may be kept longer, without your account ID, to test answer
quality. Questions are answered inside AWS in Australia and are not used to train models.
