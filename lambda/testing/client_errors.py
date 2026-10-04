"""``botocore`` ``ClientError`` instances for table stubs to raise."""

from __future__ import annotations

from botocore.exceptions import ClientError


def throttled(operation: str = 'Query') -> ClientError:
    """The ``ClientError`` DynamoDB raises when ``operation`` exceeds the provisioned throughput."""
    return ClientError({'Error': {'Code': 'ProvisionedThroughputExceededException', 'Message': 'throttled'}}, operation)
