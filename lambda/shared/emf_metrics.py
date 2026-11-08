"""
CloudWatch metrics as Embedded Metric Format log lines: a count without another API call.

The Lambda log stream is the transport; CloudWatch extracts the metric from
the JSON line (https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html).
"""

from __future__ import annotations

import json
import sys
import time


def emit_count(namespace: str, name: str, dimension: str, value: str) -> None:
    """One count of ``name`` in ``namespace``, under the single low-cardinality dimension ``dimension`` = ``value``."""
    metric = {
        '_aws': {
            'Timestamp': int(time.time() * 1000),
            'CloudWatchMetrics': [{
                'Namespace': namespace,
                'Dimensions': [[dimension]],
                'Metrics': [{'Name': name, 'Unit': 'Count'}],
            }],
        },
        dimension: value,
        name: 1,
    }
    sys.stdout.write(json.dumps(metric, separators=(',', ':')) + '\n')
