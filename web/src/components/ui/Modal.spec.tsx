import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  Modal, ConfirmModal, AlertModal 
} from './Modal';

describe('Modal', () => {
  beforeEach(() => {
    vi.spyOn(document, 'addEventListener');
    vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.style.overflow = '';
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>
    );
    
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('renders children when isOpen is true', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <p>Modal Content</p>
      </Modal>
    );
    
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Title">
        <p>Content</p>
      </Modal>
    );
    
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    
    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides close button when showCloseButton is false', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} showCloseButton={false}>
        <p>Content</p>
      </Modal>
    );
    
    expect(screen.queryByLabelText('Close modal')).not.toBeInTheDocument();
  });

  it('applies correct size class for each size option', () => {
    const { rerender } = render(
      <Modal isOpen={true} onClose={vi.fn()} size="sm">
        <p>Content</p>
      </Modal>
    );
    expect(document.querySelector('dialog')).toHaveClass('max-w-sm');

    rerender(
      <Modal isOpen={true} onClose={vi.fn()} size="xl">
        <p>Content</p>
      </Modal>
    );
    expect(document.querySelector('dialog')).toHaveClass('max-w-xl');
  });

  it('sets body overflow to hidden when open', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>
    );
    
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('removes keydown listener when unmounted', () => {
    const onClose = vi.fn();
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

describe('ConfirmModal', () => {
  it('displays title and message', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Confirm Delete"
        message="Are you sure?"
      />
    );
    
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('calls onConfirm and onClose when confirm button clicked', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Confirm"
        message="Proceed?"
      />
    );
    
    fireEvent.click(screen.getByText('OK'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls only onClose when cancel button clicked', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Confirm"
        message="Proceed?"
      />
    );
    
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses custom button text when provided', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Confirm Action"
        message="Proceed with action?"
        confirmText="Yes, proceed"
        cancelText="No, cancel"
      />
    );
    
    expect(screen.getByText('Yes, proceed')).toBeInTheDocument();
    expect(screen.getByText('No, cancel')).toBeInTheDocument();
  });

  it('applies danger styling when confirmVariant is danger', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete"
        message="Delete?"
        confirmVariant="danger"
      />
    );
    
    const confirmButton = screen.getByText('OK');
    expect(confirmButton).toHaveClass('bg-red-600');
  });
});

describe('AlertModal', () => {
  it('displays title and message', () => {
    render(
      <AlertModal
        isOpen={true}
        onClose={vi.fn()}
        title="Success"
        message="Operation completed"
      />
    );
    
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Operation completed')).toBeInTheDocument();
  });

  it('calls onClose when OK button clicked', () => {
    const onClose = vi.fn();
    render(
      <AlertModal
        isOpen={true}
        onClose={onClose}
        title="Info"
        message="Note this"
      />
    );
    
    fireEvent.click(screen.getByText('OK'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders success icon with correct color when variant is success', () => {
    const { container } = render(
      <AlertModal
        isOpen={true}
        onClose={vi.fn()}
        title="Done"
        message="Saved"
        variant="success"
      />
    );
    
    const iconContainer = container.querySelector('.text-emerald-600');
    expect(iconContainer).toBeInTheDocument();
  });

  it('renders error icon with correct color when variant is error', () => {
    const { container } = render(
      <AlertModal
        isOpen={true}
        onClose={vi.fn()}
        title="Error"
        message="Failed"
        variant="error"
      />
    );
    
    const iconContainer = container.querySelector('.text-red-600');
    expect(iconContainer).toBeInTheDocument();
  });
});
