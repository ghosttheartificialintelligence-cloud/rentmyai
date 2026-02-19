#!/usr/bin/env python3
"""Email checker for Ghost's Gmail"""
import imaplib
import os

EMAIL = "ghosttheartificialintelligence@gmail.com"
APP_PASSWORD = os.environ.get('GMAIL_APP_PASSWORD', 'zcmf dnrq ggut knmh')

def check_inbox():
    mail = imaplib.IMAP4_SSL('imap.gmail.com')
    mail.login(EMAIL, APP_PASSWORD)
    mail.select('inbox')
    
    status, messages = mail.search(None, 'ALL')
    ids = messages[0].split()
    
    print(f"Inbox: {len(ids)} emails\n")
    
    # Show last 5
    for eid in reversed(ids[-5:]):
        status, msg = mail.fetch(eid, '(RFC822)')
        msg = email.message_from_bytes(msg[0][1])
        print(f"From: {msg['From']}")
        print(f"Subject: {msg['Subject']}")
        print(f"Date: {msg['Date']}")
        print("---")
    
    mail.logout()

if __name__ == "__main__":
    import email
    check_inbox()
