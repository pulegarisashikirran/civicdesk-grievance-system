#include <stdlib.h>

#include "bst.h"
#include "util.h"

/* A NULL subtree has height zero; every leaf has height one. */
static int node_height(const BSTNode *node)
{
    return node == NULL ? 0 : node->height;
}

static void update_height(BSTNode *node)
{
    int left_height = node_height(node->left);
    int right_height = node_height(node->right);
    node->height = 1 + (left_height > right_height ? left_height : right_height);
}

static int balance_factor(const BSTNode *node)
{
    return node == NULL ? 0 : node_height(node->left) - node_height(node->right);
}

/* Right rotation fixes a left-heavy subtree. */
static BSTNode *rotate_right(BSTNode *top)
{
    BSTNode *new_top = top->left;
    BSTNode *middle = new_top->right;

    new_top->right = top;
    top->left = middle;

    update_height(top);
    update_height(new_top);
    return new_top;
}

/* Left rotation fixes a right-heavy subtree. */
static BSTNode *rotate_left(BSTNode *top)
{
    BSTNode *new_top = top->right;
    BSTNode *middle = new_top->left;

    new_top->left = top;
    top->right = middle;

    update_height(top);
    update_height(new_top);
    return new_top;
}

void bst_init(ComplaintBST *tree)
{
    if (tree == NULL)
        return;
    tree->root = NULL;
    tree->size = 0;
}

/* Recursive AVL insertion. The duplicate flag prevents duplicate IDs being added. */
static BSTNode *insert_node(BSTNode *root, Complaint *c, int *inserted)
{
    int balance;

    if (root == NULL) {
        BSTNode *node = xmalloc(sizeof(BSTNode));
        node->complaint = c;
        node->left = NULL;
        node->right = NULL;
        node->height = 1;
        *inserted = 1;
        return node;
    }

    if (c->cid < root->complaint->cid) {
        root->left = insert_node(root->left, c, inserted);
    } else if (c->cid > root->complaint->cid) {
        root->right = insert_node(root->right, c, inserted);
    } else {
        return root;                    /* duplicate complaint ID */
    }

    if (!*inserted)
        return root;

    update_height(root);
    balance = balance_factor(root);

    /* Left-left case. */
    if (balance > 1 && c->cid < root->left->complaint->cid)
        return rotate_right(root);

    /* Right-right case. */
    if (balance < -1 && c->cid > root->right->complaint->cid)
        return rotate_left(root);

    /* Left-right case. */
    if (balance > 1 && c->cid > root->left->complaint->cid) {
        root->left = rotate_left(root->left);
        return rotate_right(root);
    }

    /* Right-left case. */
    if (balance < -1 && c->cid < root->right->complaint->cid) {
        root->right = rotate_right(root->right);
        return rotate_left(root);
    }

    return root;
}

int bst_insert(ComplaintBST *tree, Complaint *c)
{
    int inserted = 0;

    if (tree == NULL || c == NULL)
        return 0;

    tree->root = insert_node(tree->root, c, &inserted);
    if (inserted)
        tree->size++;
    return inserted;
}

Complaint *bst_search(const ComplaintBST *tree, int cid)
{
    const BSTNode *current;

    if (tree == NULL)
        return NULL;

    current = tree->root;
    while (current != NULL) {
        if (cid == current->complaint->cid)
            return current->complaint;
        current = (cid < current->complaint->cid) ? current->left : current->right;
    }
    return NULL;
}

static void inorder_fill(const BSTNode *node, Complaint **out, int *index)
{
    if (node == NULL)
        return;
    inorder_fill(node->left, out, index);
    out[(*index)++] = node->complaint;
    inorder_fill(node->right, out, index);
}

Complaint **bst_inorder(const ComplaintBST *tree, int *count)
{
    int index = 0;
    Complaint **out;

    if (count == NULL)
        return NULL;
    *count = 0;
    if (tree == NULL)
        return NULL;

    out = xmalloc((size_t)tree->size * sizeof(Complaint *));
    inorder_fill(tree->root, out, &index);
    *count = index;
    return out;
}

int bst_height(const ComplaintBST *tree)
{
    return tree == NULL ? 0 : node_height(tree->root);
}

static void free_nodes(BSTNode *node)
{
    if (node == NULL)
        return;
    free_nodes(node->left);
    free_nodes(node->right);
    free(node);
}

void bst_free(ComplaintBST *tree)
{
    if (tree == NULL)
        return;
    free_nodes(tree->root);
    tree->root = NULL;
    tree->size = 0;
}
