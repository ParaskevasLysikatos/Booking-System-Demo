"""The error every email backend of ours raises (TICKET-030, shared with Brevo in TICKET-047)."""


class EmailSendError(Exception):
    """An email couldn't be sent.

    `status` is the provider's HTTP status when it answered (None when it
    couldn't be reached). `refused` = the provider said no (a 4xx other than
    429): retrying the same email won't help until something is fixed. Not
    refused = the outcome is unknown (network error, timeout, 5xx, 429).
    """

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status

    @property
    def refused(self):
        return self.status is not None and 400 <= self.status < 500 and self.status != 429
