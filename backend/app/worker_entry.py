"""Run one queued PDF and exit."""
import logging

from . import durable_jobs, queue_worker


def main():
    logging.basicConfig(level=logging.INFO)
    durable_jobs.check_storage()
    queue_worker.run_once()


if __name__ == "__main__":
    main()
